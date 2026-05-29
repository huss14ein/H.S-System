import { addMonthsToKey, financialMonthRangeFromKey, type FinancialMonthKey } from '../utils/financialMonth';

export type BudgetViewMode = 'Monthly' | 'Weekly' | 'Daily' | 'Yearly';

/**
 * Keeps Weekly/Daily anchoring inside the **selected** financial month so spend totals match
 * month navigation (and align with `sharedBudgetConsumedRpcArgs` when the same anchor is used).
 */
export function clampDateToFinancialMonthBounds(
  anchor: Date,
  financialKey: FinancialMonthKey,
  monthStartDay: number,
): Date {
  const { start, end } = financialMonthRangeFromKey(financialKey, monthStartDay);
  const t = anchor.getTime();
  if (t < start.getTime()) return new Date(start.getTime());
  if (t > end.getTime()) return new Date(end.getTime());
  return new Date(anchor.getTime());
}

export type BudgetSpendWindows = {
  rangeStart: Date;
  rangeEnd: Date;
  previousRangeStart: Date;
  previousRangeEnd: Date;
  /** Plan-year YTD through the active financial month — only for Monthly view envelope math. */
  ytdStart: Date | null;
  ytdEnd: Date | null;
};

/** YTD window from financial month 1 of `planYear` through `throughFinancialMonth` (inclusive). */
export function financialPlanYearYtdWindow(
  planYear: number,
  throughFinancialMonth: number,
  monthStartDay: number,
): { ytdStart: Date; ytdEnd: Date } {
  const { start } = financialMonthRangeFromKey({ year: planYear, month: 1 }, monthStartDay);
  const { end } = financialMonthRangeFromKey({ year: planYear, month: throughFinancialMonth }, monthStartDay);
  return { ytdStart: new Date(start.getTime()), ytdEnd: new Date(end.getTime()) };
}

/**
 * Spend aggregation windows for Budgets cards (own + shared) and shared consumed RPC.
 * Weekly = Mon–Sun week containing clamped anchor; Daily = anchor calendar day.
 */
export function computeBudgetSpendWindows(args: {
  budgetView: BudgetViewMode;
  currentYear: number;
  currentMonth: number;
  monthStartDay: number;
  anchorDate: Date;
}): BudgetSpendWindows {
  const { budgetView, currentYear, currentMonth, monthStartDay, anchorDate } = args;
  const key: FinancialMonthKey = { year: currentYear, month: currentMonth };

  let rangeStart: Date;
  let rangeEnd: Date;
  let previousRangeStart: Date;
  let previousRangeEnd: Date;
  let ytdStart: Date | null = null;
  let ytdEnd: Date | null = null;

  if (budgetView === 'Monthly') {
    const cur = financialMonthRangeFromKey(key, monthStartDay);
    rangeStart = new Date(cur.start.getTime());
    rangeEnd = new Date(cur.end.getTime());
    const prevKey = addMonthsToKey(key, -1);
    const prev = financialMonthRangeFromKey(prevKey, monthStartDay);
    previousRangeStart = new Date(prev.start.getTime());
    previousRangeEnd = new Date(prev.end.getTime());
    const ytd = financialPlanYearYtdWindow(currentYear, currentMonth, monthStartDay);
    ytdStart = ytd.ytdStart;
    ytdEnd = ytd.ytdEnd;
  } else if (budgetView === 'Weekly') {
    const anchor = clampDateToFinancialMonthBounds(anchorDate, key, monthStartDay);
    const d = new Date(anchor.getTime());
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const diffToMonday = (dow + 6) % 7;
    d.setDate(d.getDate() - diffToMonday);
    rangeStart = new Date(d.getTime());
    rangeEnd = new Date(d.getTime());
    rangeEnd.setDate(d.getDate() + 6);
    rangeEnd.setHours(23, 59, 59, 999);
    previousRangeStart = new Date(rangeStart.getTime());
    previousRangeStart.setDate(rangeStart.getDate() - 7);
    previousRangeStart.setHours(0, 0, 0, 0);
    previousRangeEnd = new Date(rangeStart.getTime());
    previousRangeEnd.setDate(rangeStart.getDate() - 1);
    previousRangeEnd.setHours(23, 59, 59, 999);
  } else if (budgetView === 'Daily') {
    const anchor = clampDateToFinancialMonthBounds(anchorDate, key, monthStartDay);
    rangeStart = new Date(anchor.getTime());
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = new Date(anchor.getTime());
    rangeEnd.setHours(23, 59, 59, 999);
    previousRangeStart = new Date(rangeStart.getTime());
    previousRangeStart.setDate(rangeStart.getDate() - 1);
    previousRangeStart.setHours(0, 0, 0, 0);
    previousRangeEnd = new Date(previousRangeStart.getTime());
    previousRangeEnd.setHours(23, 59, 59, 999);
  } else {
    rangeStart = new Date(currentYear, 0, 1, 0, 0, 0, 0);
    rangeEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    previousRangeStart = new Date(currentYear - 1, 0, 1, 0, 0, 0, 0);
    previousRangeEnd = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999);
  }

  return { rangeStart, rangeEnd, previousRangeStart, previousRangeEnd, ytdStart, ytdEnd };
}

/** Monthly card windows for a specific financial month (Admin overview, reports). */
export function computeMonthlySpendWindowsForFinancialKey(
  key: FinancialMonthKey,
  monthStartDay: number,
  anchorDate = new Date(key.year, key.month - 1, 15),
): BudgetSpendWindows {
  return computeBudgetSpendWindows({
    budgetView: 'Monthly',
    currentYear: key.year,
    currentMonth: key.month,
    monthStartDay,
    anchorDate,
  });
}

/** Human-readable label for the active card spend window (shown under “This month” / “This period”). */
export function formatBudgetSpendWindowLabel(
  budgetView: BudgetViewMode,
  rangeStart: Date,
  rangeEnd: Date,
): string {
  const sameDay =
    rangeStart.getFullYear() === rangeEnd.getFullYear() &&
    rangeStart.getMonth() === rangeEnd.getMonth() &&
    rangeStart.getDate() === rangeEnd.getDate();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  const withYear =
    budgetView === 'Yearly' ||
    rangeStart.getFullYear() !== rangeEnd.getFullYear() ||
    new Date().getFullYear() !== rangeStart.getFullYear();
  if (budgetView === 'Daily' || sameDay) return fmt(rangeStart, withYear);
  return `${fmt(rangeStart, withYear)} – ${fmt(rangeEnd, withYear)}`;
}
