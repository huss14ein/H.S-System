export type SukukPayoutCadence = 'monthly' | 'quarterly' | 'maturity_only' | 'custom';
export type SukukPayoutKind = 'coupon' | 'principal';

export type SukukPayoutSchedule = {
  id: string;
  sukukPositionId: string;
  investmentAccountId: string;
  currency: 'SAR' | 'USD';
  cadence: SukukPayoutCadence;
  dayOfMonth?: number | null;
  couponAmount?: number | null;
  principalAmount?: number | null;
  principalInstallmentAmount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  enabled?: boolean;
};

export type SukukPositionDates = {
  issueDate?: string | null;
  maturityDate?: string | null;
};

export type SukukPayoutEventDraft = {
  scheduleId: string;
  sukukPositionId: string;
  investmentAccountId: string;
  kind: SukukPayoutKind;
  payoutDate: string;
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
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, dayOfMonth));
}

export type MaterializeSukukPayoutEventsArgs = {
  schedule: SukukPayoutSchedule;
  positionDates: SukukPositionDates;
  /** When set, maturity principal defaults to this if schedule.principalAmount is null. */
  outstandingPrincipal?: number | null;
};

/**
 * Materialize payout events for a schedule.
 * - monthly / quarterly: coupon events + optional principal installments + maturity remainder
 * - maturity_only: coupon (optional) + principal at maturity (defaults to outstanding)
 * - custom: emits nothing (events are user-entered)
 */
export function materializeSukukPayoutEvents(args: MaterializeSukukPayoutEventsArgs): SukukPayoutEventDraft[] {
  const s = args.schedule;
  if (s.enabled === false) return [];
  assert(s.currency === 'SAR' || s.currency === 'USD', 'schedule currency must be SAR or USD');
  assert(
    s.cadence === 'monthly' || s.cadence === 'quarterly' || s.cadence === 'maturity_only' || s.cadence === 'custom',
    'invalid cadence',
  );

  const issue = (args.positionDates.issueDate ?? null) as string | null;
  const maturity = (args.positionDates.maturityDate ?? null) as string | null;
  const start = (s.startDate ?? issue ?? null) as string | null;
  const end = (s.endDate ?? maturity ?? null) as string | null;
  const outstanding = Math.max(0, Number(args.outstandingPrincipal ?? 0) || 0);

  if (start) assert(ISO_DAY_RE.test(start), 'startDate must be YYYY-MM-DD');
  if (end) assert(ISO_DAY_RE.test(end), 'endDate must be YYYY-MM-DD');
  if (issue) assert(ISO_DAY_RE.test(issue), 'issueDate must be YYYY-MM-DD');
  if (maturity) assert(ISO_DAY_RE.test(maturity), 'maturityDate must be YYYY-MM-DD');

  const coupon = Number(s.couponAmount ?? 0);
  const principalConfigured = s.principalAmount == null ? null : Number(s.principalAmount);
  const principalInstallment = Number(s.principalInstallmentAmount ?? 0);
  if (coupon < 0 || !Number.isFinite(coupon)) throw new Error('couponAmount must be a non-negative number');
  if (principalConfigured != null && (!Number.isFinite(principalConfigured) || principalConfigured < 0)) {
    throw new Error('principalAmount must be a non-negative number');
  }
  if (principalInstallment < 0 || !Number.isFinite(principalInstallment)) {
    throw new Error('principalInstallmentAmount must be a non-negative number');
  }

  const pushPrincipal = (events: SukukPayoutEventDraft[], payoutDate: string, amount: number) => {
    if (!(amount > 0)) return;
    events.push({
      scheduleId: s.id,
      sukukPositionId: s.sukukPositionId,
      investmentAccountId: s.investmentAccountId,
      kind: 'principal',
      payoutDate,
      amount,
      currency: s.currency,
    });
  };

  const events: SukukPayoutEventDraft[] = [];

  if (s.cadence === 'custom') return events;

  if (s.cadence === 'maturity_only') {
    assert(maturity, 'maturity-only requires position maturityDate');
    if (coupon > 0) {
      events.push({
        scheduleId: s.id,
        sukukPositionId: s.sukukPositionId,
        investmentAccountId: s.investmentAccountId,
        kind: 'coupon',
        payoutDate: maturity,
        amount: coupon,
        currency: s.currency,
      });
    }
    const matPrincipal =
      principalConfigured != null && principalConfigured > 0 ? principalConfigured : outstanding;
    pushPrincipal(events, maturity, matPrincipal);
    return events;
  }

  const stepMonths = s.cadence === 'monthly' ? 1 : 3;
  const dom = Math.max(1, Math.min(28, Math.trunc(Number(s.dayOfMonth ?? 1))));
  assert(start, 'monthly/quarterly requires a start date (schedule.startDate or position issueDate)');
  assert(end, 'monthly/quarterly requires an end date (schedule.endDate or position maturityDate)');

  const startAnchor = new Date(`${start}T00:00:00Z`);
  const endAnchor = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startAnchor.getTime()) || Number.isNaN(endAnchor.getTime())) {
    throw new Error('Invalid start/end date');
  }

  const anchorMonth = new Date(Date.UTC(startAnchor.getUTCFullYear(), startAnchor.getUTCMonth(), dom));
  let principalPaid = 0;
  let i = 0;
  while (true) {
    const dt = addMonthsUtc(anchorMonth, i * stepMonths, dom);
    const ymd = toYmd(dt);
    if (ymd > end) break;
    if (ymd >= start) {
      if (coupon > 0) {
        events.push({
          scheduleId: s.id,
          sukukPositionId: s.sukukPositionId,
          investmentAccountId: s.investmentAccountId,
          kind: 'coupon',
          payoutDate: ymd,
          amount: coupon,
          currency: s.currency,
        });
      }
      if (principalInstallment > 0 && ymd < (maturity ?? end)) {
        pushPrincipal(events, ymd, principalInstallment);
        principalPaid += principalInstallment;
      }
    }
    i++;
    if (i > 500) break;
  }

  if (maturity && end === maturity) {
    const remainder =
      principalConfigured != null && principalConfigured > 0
        ? principalConfigured
        : Math.max(0, outstanding - principalPaid);
    pushPrincipal(events, maturity, remainder);
  }

  return events;
}
