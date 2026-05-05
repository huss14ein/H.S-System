import type { Budget } from '../types';

/** Stored limit → normalized monthly SAR equivalent (matches Budgets.tsx / household engine). */
export function monthlyEquivalentStoredLimit(b: Pick<Budget, 'limit' | 'period'>): number {
  const p = b.period ?? 'monthly';
  if (p === 'yearly') return b.limit / 12;
  if (p === 'weekly') return b.limit * (52 / 12);
  if (p === 'daily') return b.limit * (365 / 12);
  return b.limit;
}

/**
 * Total annual envelope for a category in a calendar year: sum of monthly-equivalent limits
 * across all budget rows. If a **yearly** row exists, its `limit` is the full-year cap (dominates).
 * If only **one monthly** row exists (typical copy-one-month workflow), extrapolate ×12.
 */
export function annualEnvelopeLimitForCategory(category: string, year: number, budgets: Budget[]): number {
  const rows = budgets.filter((b) => b.category === category && b.year === year);
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
