import { describe, expect, it } from 'vitest';
import {
  computeGoalResolvedAmountsSar,
  averageRollingMonthlyNetSurplus,
  resolvedGoalAmountsFingerprint,
  formatGoalsProgressForPrompt,
} from '../services/goalResolvedTotals';
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

  it('averageRollingMonthlyNetSurplus converts USD account flows to SAR before averaging', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const day = `${y}-${m}-15`;
    const data = {
      goals: [],
      assets: [],
      investments: [],
      liabilities: [],
      budgets: [],
      accounts: [{ id: 'usd-check', type: 'Checking', currency: 'USD', balance: 0 }],
      transactions: [
        {
          id: 't1',
          date: day,
          accountId: 'usd-check',
          amount: 100,
          type: 'Income',
          category: 'Salary',
        },
      ],
    } as unknown as FinancialData;
    const avg = averageRollingMonthlyNetSurplus(data, 1, 3.75);
    expect(avg).toBeCloseTo(375, 5);
  });

  it('formatGoalsProgressForPrompt uses resolved amounts not stored currentAmount', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'House',
      targetAmount: 10000,
      currentAmount: 100,
      deadline: '2030-01-01',
      priority: 'High',
    };
    const data = {
      goals: [goal],
      assets: [{ id: 'a1', name: 'Linked', value: 5000, goalId: 'g1' }],
      investments: [],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    const line = formatGoalsProgressForPrompt(data, 3.75);
    expect(line).toContain('50%');
  });

  it('resolvedGoalAmountsFingerprint changes when resolved totals change', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'X',
      targetAmount: 100,
      currentAmount: 0,
      deadline: '2030-01-01',
      priority: 'Low',
    };
    const d1 = { goals: [goal], assets: [], investments: [], liabilities: [], transactions: [], accounts: [], budgets: [] } as unknown as FinancialData;
    const d2 = {
      goals: [goal],
      assets: [{ id: 'a1', value: 10, goalId: 'g1' }],
      investments: [],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    expect(resolvedGoalAmountsFingerprint(d1, 3.75)).not.toBe(resolvedGoalAmountsFingerprint(d2, 3.75));
  });
});
