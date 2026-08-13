/**
 * Calendar age of invested capital (first economic deposit → today).
 * Shared by headline ROI and platform/portfolio cards — no FX, no P/L.
 */
import { isCapitalInvestmentDeposit } from './reconciliation/cashDelta';
import { appCalendarTodayYmd } from './reconciliation/constants';

export const HEADLINE_NEAR_ZERO_NET_INVESTED_SAR = 1;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day only — rejects anything that is not YYYY-MM-DD (XSS / injection defense). */
export function safeCapitalDepositYmd(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').slice(0, 10);
  return YMD_RE.test(d) ? d : null;
}

export function earliestCapitalDepositYmd(
  transactions: Array<{
    date?: string | null;
    type?: string | null;
    note?: string | null;
    description?: string | null;
    category?: string | null;
    idempotencyKey?: string | null;
  }>,
): string | null {
  let min: string | null = null;
  for (const t of transactions) {
    if (!isCapitalInvestmentDeposit(t)) continue;
    const d = safeCapitalDepositYmd(t.date);
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

export function investmentAgeDaysFromYmd(
  startYmd: string | null | undefined,
  asOfYmd: string = appCalendarTodayYmd(),
): number | null {
  const start = safeCapitalDepositYmd(startYmd);
  const asOf = safeCapitalDepositYmd(asOfYmd);
  if (!start || !asOf) return null;
  const startMs = Date.parse(`${start}T00:00:00`);
  const asOfMs = Date.parse(`${asOf}T00:00:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(asOfMs) || asOfMs < startMs) return null;
  return Math.floor((asOfMs - startMs) / 86_400_000);
}

export function formatInvestmentAgeLabel(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  const n = Math.floor(days);
  if (n < 1) return 'Started today';
  if (n === 1) return '1 day invested';
  if (n < 31) return `${n} days invested`;
  const months = Math.floor(n / 30.4375);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} invested`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths === 0) return `${years} year${years === 1 ? '' : 's'} invested`;
  return `${years}y ${remMonths}mo invested`;
}
