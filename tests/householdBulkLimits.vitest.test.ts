import { describe, it, expect } from 'vitest';
import {
  computeBulkAddLimitsForSelection,
  deriveEngineProfileFromRiskProfile,
  generateHouseholdBudgetCategories,
  householdConsumptionScale,
  monthlyEquivalentFromBudgetLimit,
} from '../services/householdBudgetEngine';

function sumMonthlyForCategories<T extends { category: string; limit: number; period: string }>(
  rows: T[],
  names: string[],
): number {
  let s = 0;
  for (const c of rows) {
    if (!names.includes(c.category)) continue;
    s += monthlyEquivalentFromBudgetLimit(c.limit, c.period as 'monthly' | 'weekly' | 'yearly' | 'daily');
  }
  return s;
}

describe('computeBulkAddLimitsForSelection', () => {
  it('leaves all rows unchanged when every category is selected', () => {
    const base = generateHouseholdBudgetCategories(2, 1, 20_000, 'Moderate');
    const all = base.map((c) => c.category);
    const out = computeBulkAddLimitsForSelection(base, all, 20_000, 'Moderate', 2, 1);
    expect(out.map((c) => c.limit)).toEqual(base.map((c) => c.limit));
  });

  it('allocates the full profile envelope across selected categories only', () => {
    const salary = 10_000;
    const base = generateHouseholdBudgetCategories(2, 0, salary, 'Moderate');
    const pick = base.slice(0, 6).map((c) => c.category);
    const out = computeBulkAddLimitsForSelection(base, pick, salary, 'Moderate', 2, 0);
    const sumSel = sumMonthlyForCategories(out, pick);
    const basePct = 0.58 * 1.05;
    const headScale = householdConsumptionScale(2, 0);
    const envelopePct = Math.min(0.74, basePct * Math.min(1.14, headScale / 1.02));
    const envelope = salary * envelopePct;
    expect(sumSel).toBeCloseTo(envelope, -1);
  });

  it('Aggressive profile yields a wider envelope than Conservative for the same selection and household', () => {
    const base = generateHouseholdBudgetCategories(3, 2, 25_000, 'Moderate');
    const pick = [base[0]!.category, base[1]!.category];
    const cons = computeBulkAddLimitsForSelection(base, pick, 25_000, 'Conservative', 3, 2);
    const aggr = computeBulkAddLimitsForSelection(base, pick, 25_000, 'Aggressive', 3, 2);
    expect(sumMonthlyForCategories(aggr, pick)).toBeGreaterThan(sumMonthlyForCategories(cons, pick) * 1.05);
  });

  it('treats selection as “all categories” when every template row is checked even if stale names remain in the array', () => {
    const base = generateHouseholdBudgetCategories(2, 0, 15_000, 'Moderate');
    const allNames = base.map((c) => c.category);
    const withStale = [...allNames, 'Housing Rent (Monthly)', 'Housing Rent (Semi-Annual)'];
    const out = computeBulkAddLimitsForSelection(base, withStale, 15_000, 'Moderate', 2, 0);
    expect(out.map((c) => c.limit)).toEqual(base.map((c) => c.limit));
  });

  it('Growth profile uses a tighter bulk envelope than Aggressive for the same selection', () => {
    const base = generateHouseholdBudgetCategories(2, 1, 20_000, 'Moderate');
    const pick = base.slice(0, 5).map((c) => c.category);
    const growth = computeBulkAddLimitsForSelection(base, pick, 20_000, 'Growth', 2, 1);
    const aggr = computeBulkAddLimitsForSelection(base, pick, 20_000, 'Aggressive', 2, 1);
    expect(sumMonthlyForCategories(aggr, pick)).toBeGreaterThan(sumMonthlyForCategories(growth, pick) * 1.02);
  });

  it('returns zero limits for every row when nothing is selected (bulk-add UX)', () => {
    const base = generateHouseholdBudgetCategories(2, 0, 12_000, 'Moderate');
    const out = computeBulkAddLimitsForSelection(base, [], 12_000, 'Moderate', 2, 0);
    expect(out.every((c) => c.limit === 0)).toBe(true);
  });

  it('zeros out unchecked categories when only a subset is selected', () => {
    const base = generateHouseholdBudgetCategories(2, 0, 12_000, 'Moderate');
    const pick = [base[0]!.category];
    const out = computeBulkAddLimitsForSelection(base, pick, 12_000, 'Moderate', 2, 0);
    const picked = out.find((c) => c.category === pick[0]);
    expect(picked != null && picked.limit > 0).toBe(true);
    expect(out.filter((c) => !pick.includes(c.category)).every((c) => c.limit === 0)).toBe(true);
  });
});

describe('deriveEngineProfileFromRiskProfile', () => {
  it('maps aggressive risk profile to Aggressive', () => {
    expect(deriveEngineProfileFromRiskProfile('Moderate', 'Aggressive')).toBe('Aggressive');
  });

  it('maps growth risk profile to Growth', () => {
    expect(deriveEngineProfileFromRiskProfile('Moderate', 'Growth')).toBe('Growth');
  });

  it('does not override manual non-default profile', () => {
    expect(deriveEngineProfileFromRiskProfile('Conservative', 'Aggressive')).toBe('Conservative');
  });
});
