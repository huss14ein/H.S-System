import type { FinancialData } from '../types';
import type { BudgetDriftRow } from './budgetDrift';
import {
  financialMonthKey,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { getPersonalTransactions } from '../utils/wealthScope';

export type BudgetMonthOpenHint = {
  id: string;
  message: string;
  action?: 'copy-last-month' | 'review-drift';
};

const OPEN_WINDOW_DAYS = 7;

/** Actionable hints during the first week of a financial month (Budgets page). */
export function buildBudgetMonthOpenHints(args: {
  data: FinancialData;
  currentViewKey: FinancialMonthKey;
  budgetDrift: BudgetDriftRow[];
  budgets: Array<{ category: string; year: number; month: number }>;
  ref?: Date;
}): BudgetMonthOpenHint[] {
  const ref = args.ref ?? new Date();
  const msd = resolveMonthStartDayFromData(args.data);
  const viewKey = financialMonthKey(ref, msd);
  if (viewKey.year !== args.currentViewKey.year || viewKey.month !== args.currentViewKey.month) {
    return [];
  }
  const { start } = financialMonthRangeFromKey(args.currentViewKey, msd);
  const dayIndex = Math.floor((startOfLocalDay(ref).getTime() - startOfLocalDay(start).getTime()) / 86_400_000);
  if (dayIndex < 0 || dayIndex > OPEN_WINDOW_DAYS) return [];

  const hints: BudgetMonthOpenHint[] = [];
  const hasRowsThisMonth = args.budgets.some(
    (b) => Number(b.year) === args.currentViewKey.year && Number(b.month) === args.currentViewKey.month,
  );
  if (!hasRowsThisMonth && dayIndex <= 3) {
    hints.push({
      id: 'copy-last-month',
      message: 'This financial month has no budget rows yet — copy last month or add categories.',
      action: 'copy-last-month',
    });
  }

  const spentCats = new Set<string>();
  const { start: winStart, end: winEnd } = financialMonthRangeFromKey(args.currentViewKey, msd);
  for (const t of getPersonalTransactions(args.data)) {
    if (t.type !== 'expense') continue;
    const d = new Date(t.date);
    if (d < winStart || d > winEnd) continue;
    const cat = String(t.budgetCategory ?? t.category ?? '').trim();
    if (cat) spentCats.add(cat);
  }
  const budgetedCats = new Set(
    args.budgets
      .filter((b) => Number(b.year) === args.currentViewKey.year && Number(b.month) === args.currentViewKey.month)
      .map((b) => String(b.category).trim()),
  );
  const missingBudget = [...spentCats].filter((c) => !budgetedCats.has(c)).slice(0, 2);
  for (const cat of missingBudget) {
    hints.push({
      id: `missing-${cat}`,
      message: `${cat} has spend this month but no budget row — add a limit or request one.`,
    });
  }

  for (const d of args.budgetDrift.slice(0, 2)) {
    if (Math.abs(d.driftPct) < 20) continue;
    hints.push({
      id: `drift-${d.category}`,
      message: `${d.category} is ${d.driftPct > 0 ? 'above' : 'below'} your 3‑month average (${Math.round(Math.abs(d.driftPct))}%).`,
      action: 'review-drift',
    });
  }

  return hints.slice(0, 4);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function budgetMonthOpenDismissKey(key: FinancialMonthKey): string {
  return `budget-month-open-dismissed-${key.year}-${String(key.month).padStart(2, '0')}`;
}
