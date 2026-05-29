import type { Budget } from '../types';
import { budgetRowViewMatchScore, financialMonthKey, type FinancialMonthKey } from '../utils/financialMonth';

/** Stored limit → normalized monthly SAR equivalent (matches Budgets.tsx / household engine). */
export function monthlyEquivalentStoredLimit(b: Pick<Budget, 'limit' | 'period'>): number {
  const p = b.period ?? 'monthly';
  if (p === 'yearly') return b.limit / 12;
  if (p === 'weekly') return b.limit * (52 / 12);
  if (p === 'daily') return b.limit * (365 / 12);
  return b.limit;
}

/**
 * Collapse overlapping legacy rows (e.g. calendar month 5 + financial index 4) into one row per financial month.
 */
export function dedupeBudgetRowsByFinancialMonthInYear<T extends Budget>(
  rows: T[],
  year: number,
  monthStartDay: unknown,
): T[] {
  const byFinMonth = new Map<string, T>();
  for (const r of rows) {
    if (Number(r.year) !== year) continue;
    const month = Number(r.month);
    if (!Number.isFinite(month)) continue;
    const anchor = new Date(year, month - 1, 15);
    const finKey = financialMonthKey(anchor, monthStartDay);
    const fk = `${finKey.year}::${finKey.month}`;
    const viewKey: FinancialMonthKey = { year: finKey.year, month: finKey.month };
    const prev = byFinMonth.get(fk);
    if (!prev) {
      byFinMonth.set(fk, r);
      continue;
    }
    if (r.period === 'yearly' && prev.period !== 'yearly') {
      byFinMonth.set(fk, r);
      continue;
    }
    if (prev.period === 'yearly' && r.period !== 'yearly') {
      continue;
    }
    const scoreR = budgetRowViewMatchScore(r, viewKey, monthStartDay);
    const scorePrev = budgetRowViewMatchScore(prev, viewKey, monthStartDay);
    if (
      scoreR > scorePrev ||
      (scoreR === scorePrev && Number(r.limit) > Number(prev.limit))
    ) {
      byFinMonth.set(fk, r);
    }
  }
  return Array.from(byFinMonth.values());
}

/**
 * Total annual envelope for a category in a calendar year: sum of monthly-equivalent limits
 * across distinct financial months. If a **yearly** row exists, its `limit` is the full-year cap (dominates).
 * If only **one monthly** row exists (typical copy-one-month workflow), extrapolate ×12.
 */
export function annualEnvelopeLimitForCategory(
  category: string,
  year: number,
  budgets: Budget[],
  monthStartDay: unknown = 1,
): number {
  const rows = dedupeBudgetRowsByFinancialMonthInYear(
    budgets.filter((b) => b.category === category && b.year === year),
    year,
    monthStartDay,
  );
  if (rows.length === 0) return 0;

  const yearlyRows = rows.filter((r) => r.period === 'yearly');
  if (yearlyRows.length > 0) {
    return Math.max(...yearlyRows.map((r) => r.limit));
  }

  let sumMonthlyEq = 0;
  for (const r of rows) {
    sumMonthlyEq += monthlyEquivalentStoredLimit(r);
  }

  const monthlyRows = rows.filter((r) => (r.period ?? 'monthly') === 'monthly');
  if (rows.length === 1 && monthlyRows.length === 1) {
    return monthlyEquivalentStoredLimit(monthlyRows[0]) * 12;
  }

  return sumMonthlyEq;
}
