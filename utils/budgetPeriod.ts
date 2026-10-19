/**
 * Leaf helpers for budget period / category keys (safe for utils ↔ services imports).
 */

/** Normalize stored period strings (`Yearly`, ` yearly `, etc.) to a canonical token. */
export function normalizeBudgetPeriod(
  period: string | null | undefined,
): 'yearly' | 'weekly' | 'daily' | 'monthly' {
  const p = String(period ?? 'monthly').trim().toLowerCase();
  if (p === 'yearly' || p === 'annual' || p === 'annually') return 'yearly';
  if (p === 'weekly' || p === 'week') return 'weekly';
  if (p === 'daily' || p === 'day') return 'daily';
  return 'monthly';
}

/** True when the stored budget row is a yearly-period plan (any category). */
export function isYearlyPeriodBudget(b: { period?: string | null } | null | undefined): boolean {
  return normalizeBudgetPeriod(b?.period) === 'yearly';
}

/** Case-insensitive category key for matching budgets ↔ transaction tags. */
export function normalizeBudgetCategoryKey(category: string | null | undefined): string {
  return String(category ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Collapse a spend map to normalized category keys (one O(n) pass).
 * Use with {@link spendFromNormalizedLookup} in hot loops instead of repeated scans.
 */
export function buildNormalizedSpendLookup(map: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of map) {
    const key = normalizeBudgetCategoryKey(k);
    if (!key) continue;
    const n = Number(v) || 0;
    if (!(n > 0)) continue;
    out.set(key, (out.get(key) ?? 0) + n);
  }
  return out;
}

/** O(1) spend lookup after {@link buildNormalizedSpendLookup}. */
export function spendFromNormalizedLookup(
  lookup: Map<string, number>,
  category: string,
): number {
  const key = normalizeBudgetCategoryKey(category);
  if (!key) return 0;
  return lookup.get(key) ?? 0;
}

/** Find spend in a map allowing case/whitespace-insensitive category keys. */
export function spendFromCategoryMap(
  map: Map<string, number>,
  category: string,
): number {
  const direct = map.get(category);
  if (direct != null) return direct;
  const key = normalizeBudgetCategoryKey(category);
  if (!key) return 0;
  let sum = 0;
  let matched = false;
  for (const [k, v] of map) {
    if (normalizeBudgetCategoryKey(k) === key) {
      sum += v;
      matched = true;
    }
  }
  return matched ? sum : 0;
}
