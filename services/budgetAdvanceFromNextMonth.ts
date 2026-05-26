import type { Budget, BudgetRequest } from '../types';
import { addMonthsToKey, financialMonthKey, type FinancialMonthKey } from '../utils/financialMonth';
import { monthlyEquivalentStoredLimit } from './budgetEnvelopeMath';

export const ADVANCE_FROM_NEXT_MONTH_TAG = '[Request mode: AdvanceFromNextMonth]';

export function buildAdvanceFromNextMonthNoteTag(from: FinancialMonthKey, to: FinancialMonthKey): string {
  return `[AdvanceFromNextMonth: from=${from.year}-${String(from.month).padStart(2, '0')}; to=${to.year}-${String(to.month).padStart(2, '0')}]`;
}

export function parseAdvanceFromNextMonthNote(note: string | undefined | null): {
  from: FinancialMonthKey;
  to: FinancialMonthKey;
} | null {
  const m = String(note ?? '').match(
    /\[AdvanceFromNextMonth:\s*from=(\d{4})-(\d{2});\s*to=(\d{4})-(\d{2})\]/i,
  );
  if (!m) return null;
  return {
    from: { year: Number(m[1]), month: Number(m[2]) },
    to: { year: Number(m[3]), month: Number(m[4]) },
  };
}

/** Financial month after the view key (respects monthStartDay). */
export function nextFinancialMonthKey(view: FinancialMonthKey, monthStartDay: unknown): FinancialMonthKey {
  const anchor = new Date(view.year, view.month - 1, 15);
  const fin = financialMonthKey(anchor, monthStartDay);
  return addMonthsToKey(fin, 1);
}

export function findBudgetRowForCategoryMonth(
  budgets: Budget[],
  category: string,
  key: FinancialMonthKey,
): Budget | undefined {
  return budgets.find(
    (b) =>
      String(b.category).trim() === String(category).trim() &&
      Number(b.year) === key.year &&
      Number(b.month) === key.month,
  );
}

/** Headroom in next financial month (limit − spent) for same category. */
export function computeNextMonthBorrowHeadroomSar(args: {
  budgets: Budget[];
  category: string;
  currentView: FinancialMonthKey;
  monthStartDay: unknown;
  spentByCategoryNextMonth?: Map<string, number>;
}): number {
  const nextKey = nextFinancialMonthKey(args.currentView, args.monthStartDay);
  const row = findBudgetRowForCategoryMonth(args.budgets, args.category, nextKey);
  if (!row) return 0;
  const limit = monthlyEquivalentStoredLimit(row);
  const spent = args.spentByCategoryNextMonth?.get(args.category) ?? 0;
  return Math.max(0, limit - spent);
}

export function effectiveBudgetLimitSar(storedLimit: number, advanceInSar = 0, advanceOutSar = 0): number {
  return Math.max(0, storedLimit + advanceInSar - advanceOutSar);
}

/** Finalized advance transfers touching a category + financial month (limits in DB already include these). */
export function summarizeFinalizedAdvanceTransfers(args: {
  requests: BudgetRequest[] | undefined;
  category: string;
  month: FinancialMonthKey;
}): { borrowedInSar: number; lentOutSar: number } {
  let borrowedInSar = 0;
  let lentOutSar = 0;
  const cat = String(args.category).trim();
  for (const req of args.requests ?? []) {
    if (String(req.status ?? '').toLowerCase() !== 'finalized') continue;
    const note = String((req as { request_note?: string }).request_note ?? req.note ?? '');
    if (
      req.requestType !== 'AdvanceFromNextMonth' &&
      !/\[Request mode:\s*AdvanceFromNextMonth\]/i.test(note)
    ) {
      continue;
    }
    const resolvedCategory = String(req.categoryName ?? (req as { category_name?: string }).category_name ?? '').trim();
    if (resolvedCategory && resolvedCategory !== cat) continue;
    const parsed = parseAdvanceFromNextMonthNote(note);
    if (!parsed) continue;
    const amount = Number(req.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (parsed.to.year === args.month.year && parsed.to.month === args.month.month) {
      borrowedInSar += amount;
    }
    if (parsed.from.year === args.month.year && parsed.from.month === args.month.month) {
      lentOutSar += amount;
    }
  }
  return { borrowedInSar, lentOutSar };
}

/** Utilization cap on cards (stored limit already reflects finalized advance RPC). */
export function effectiveMonthlyLimitSar(storedLimit: number): number {
  return Math.max(0, storedLimit);
}
