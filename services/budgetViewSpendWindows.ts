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
  /** Calendar-year YTD through `rangeEnd` — only for Monthly view envelope math. */
  ytdStart: Date | null;
  ytdEnd: Date | null;
};

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
    ytdStart = new Date(currentYear, 0, 1, 0, 0, 0, 0);
    ytdEnd = new Date(rangeEnd.getTime());
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
