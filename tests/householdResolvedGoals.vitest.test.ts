import { describe, expect, it } from 'vitest';
import { buildHouseholdEngineInputFromData, mergeGoalRowsWithResolvedCurrentSar } from '../services/householdBudgetEngine';
import type { FinancialData, Goal } from '../types';

describe('householdBudgetEngine resolved goals', () => {
  it('mergeGoalRowsWithResolvedCurrentSar overrides stored currentAmount when linked wealth exists', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'Trip',
      targetAmount: 10000,
      currentAmount: 500,
      deadline: '2030-01-01',
      priority: 'Medium',
    };
    const data = {
      goals: [goal],
      assets: [{ id: 'a1', name: 'Cash stash', value: 2000, goalId: 'g1' }],
      investments: [],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    const merged = mergeGoalRowsWithResolvedCurrentSar([goal], data, 3.75);
    expect(merged[0]?.currentAmount).toBeCloseTo(2000, 5);

    const input = buildHouseholdEngineInputFromData([], [], merged as Parameters<typeof buildHouseholdEngineInputFromData>[2], {
      year: new Date().getFullYear(),
      financialData: data,
      sarPerUsd: 3.75,
    });
    expect(input.goals.find((g) => g.id === 'g1')?.currentAmount).toBeCloseTo(2000, 5);
  });
});
