import { describe, expect, it } from 'vitest';
import { computeGoalResolvedAmountsSar, averageRollingMonthlyNetSurplus } from '../services/goalResolvedTotals';
import type { FinancialData, Goal } from '../types';

describe('goalResolvedTotals', () => {
  it('sums linked asset and linked investment values per goal id', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'House',
      targetAmount: 100000,
      deadline: '2030-01-01',
      priority: 'High',
    };
    const data = {
      goals: [goal],
      assets: [{ id: 'a1', name: 'Gold', value: 5000, goalId: 'g1' }],
      investments: [
        {
          id: 'p1',
          name: 'PF',
          goalId: 'g1',
          currency: 'SAR' as const,
          holdings: [{ id: 'h1', symbol: 'STOCK', quantity: 1, avgCost: 10, currentValue: 3000 }],
        },
      ],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    expect(m.get('g1')).toBeCloseTo(8000, 5);
  });

  it('averageRollingMonthlyNetSurplus returns 0 when no transactions', () => {
    expect(averageRollingMonthlyNetSurplus(null)).toBe(0);
  });
});
