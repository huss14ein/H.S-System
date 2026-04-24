export type SukukPayoutCadence = 'monthly' | 'quarterly' | 'maturity_only' | 'custom';
export type SukukPayoutKind = 'coupon' | 'principal';

export type SukukPayoutSchedule = {
  id: string;
  assetId: string;
  investmentAccountId: string;
  currency: 'SAR' | 'USD';
  cadence: SukukPayoutCadence;
  dayOfMonth?: number | null; // 1-28
  couponAmount?: number | null;
  principalAmount?: number | null;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  enabled?: boolean;
};

export type SukukAssetDates = {
  issueDate?: string | null;
  maturityDate?: string | null;
};

export type SukukPayoutEventDraft = {
  scheduleId: string;
  assetId: string;
  investmentAccountId: string;
  kind: SukukPayoutKind;
  payoutDate: string; // YYYY-MM-DD
  amount: number;
  currency: 'SAR' | 'USD';
  metadata?: Record<string, unknown>;
};

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonthsUtc(anchor: Date, months: number, dayOfMonth: number): Date {
  // Keep on a stable day (1-28), UTC.
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, dayOfMonth));
}

/**
 * Materialize payout events for a schedule.
 * - monthly / quarterly: emits coupon events from start→end inclusive (bounded by asset dates)
 * - maturity_only: emits principal event at maturity (and optional coupon at maturity if couponAmount provided)
 * - custom: emits nothing (events are user-entered)
 */
export function materializeSukukPayoutEvents(args: {
  schedule: SukukPayoutSchedule;
  assetDates: SukukAssetDates;
}): SukukPayoutEventDraft[] {
  const s = args.schedule;
  if (s.enabled === false) return [];
  assert(s.currency === 'SAR' || s.currency === 'USD', 'schedule currency must be SAR or USD');
  assert(s.cadence === 'monthly' || s.cadence === 'quarterly' || s.cadence === 'maturity_only' || s.cadence === 'custom', 'invalid cadence');

  const issue = (args.assetDates.issueDate ?? null) as string | null;
  const maturity = (args.assetDates.maturityDate ?? null) as string | null;
  const start = (s.startDate ?? issue ?? null) as string | null;
  const end = (s.endDate ?? maturity ?? null) as string | null;

  if (start) assert(ISO_DAY_RE.test(start), 'startDate must be YYYY-MM-DD');
  if (end) assert(ISO_DAY_RE.test(end), 'endDate must be YYYY-MM-DD');
  if (issue) assert(ISO_DAY_RE.test(issue), 'issueDate must be YYYY-MM-DD');
  if (maturity) assert(ISO_DAY_RE.test(maturity), 'maturityDate must be YYYY-MM-DD');

  const coupon = Number(s.couponAmount ?? 0);
  const principal = s.principalAmount == null ? null : Number(s.principalAmount);
  if (coupon < 0 || !Number.isFinite(coupon)) throw new Error('couponAmount must be a non-negative number');
  if (principal != null && (!Number.isFinite(principal) || principal < 0)) throw new Error('principalAmount must be a non-negative number');

  const events: SukukPayoutEventDraft[] = [];

  if (s.cadence === 'custom') return events;

  if (s.cadence === 'maturity_only') {
    assert(maturity, 'maturity-only requires asset maturityDate');
    if (coupon > 0) {
      events.push({
        scheduleId: s.id,
        assetId: s.assetId,
        investmentAccountId: s.investmentAccountId,
        kind: 'coupon',
        payoutDate: maturity,
        amount: coupon,
        currency: s.currency,
      });
    }
    if (principal != null && principal > 0) {
      events.push({
        scheduleId: s.id,
        assetId: s.assetId,
        investmentAccountId: s.investmentAccountId,
        kind: 'principal',
        payoutDate: maturity,
        amount: principal,
        currency: s.currency,
      });
    }
    return events;
  }

  const stepMonths = s.cadence === 'monthly' ? 1 : 3;
  const dom = Math.max(1, Math.min(28, Math.trunc(Number(s.dayOfMonth ?? 1))));
  assert(start, 'monthly/quarterly requires a start date (schedule.startDate or asset.issueDate)');
  assert(end, 'monthly/quarterly requires an end date (schedule.endDate or asset.maturityDate)');
  if (coupon <= 0) return events;

  const startAnchor = new Date(`${start}T00:00:00Z`);
  const endAnchor = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startAnchor.getTime()) || Number.isNaN(endAnchor.getTime())) throw new Error('Invalid start/end date');

  // First payout month uses start month; we anchor to that month with configured day-of-month.
  const anchorMonth = new Date(Date.UTC(startAnchor.getUTCFullYear(), startAnchor.getUTCMonth(), dom));
  let i = 0;
  while (true) {
    const dt = addMonthsUtc(anchorMonth, i * stepMonths, dom);
    const ymd = toYmd(dt);
    if (ymd > end) break;
    if (ymd >= start) {
      events.push({
        scheduleId: s.id,
        assetId: s.assetId,
        investmentAccountId: s.investmentAccountId,
        kind: 'coupon',
        payoutDate: ymd,
        amount: coupon,
        currency: s.currency,
      });
    }
    i++;
    if (i > 500) break; // safety
  }

  // If principal is specified and end aligns to maturity, add it once.
  if (principal != null && principal > 0 && maturity && end === maturity) {
    events.push({
      scheduleId: s.id,
      assetId: s.assetId,
      investmentAccountId: s.investmentAccountId,
      kind: 'principal',
      payoutDate: maturity,
      amount: principal,
      currency: s.currency,
    });
  }

  return events;
}

