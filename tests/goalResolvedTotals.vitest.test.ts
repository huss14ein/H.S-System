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

  it('splits a portfolio-level default goal across lots when holdings override goalId (matches Goals card)', () => {
    const goals: Goal[] = [
      { id: 'gA', name: 'A', targetAmount: 100000, currentAmount: 0, deadline: '2030-01-01', priority: 'High' },
      { id: 'gB', name: 'B', targetAmount: 100000, currentAmount: 0, deadline: '2030-01-01', priority: 'High' },
    ];
    const data = {
      goals,
      assets: [],
      investments: [
        {
          id: 'p1',
          name: 'Mixed',
          goalId: 'gA',
          currency: 'SAR' as const,
          holdings: [
            { id: 'h1', symbol: 'X', quantity: 1, avgCost: 1, currentValue: 1000, realizedPnL: 0 },
            { id: 'h2', symbol: 'Y', quantity: 1, avgCost: 1, currentValue: 4000, goalId: 'gB', realizedPnL: 0 },
          ],
        },
      ],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    expect(m.get('gA')).toBeCloseTo(1000, 5);
    expect(m.get('gB')).toBeCloseTo(4000, 5);
  });

  it('infers SAR portfolio book when currency is unset but holdings are Tadawul .SR (no false USD conversion)', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'Saudi savings',
      targetAmount: 50_000,
      deadline: '2030-01-01',
      priority: 'High',
    };
    const data = {
      goals: [goal],
      assets: [],
      investments: [
        {
          id: 'p1',
          name: 'Tadawul PF',
          goalId: 'g1',
          holdings: [{ id: 'h1', symbol: '1150.SR', quantity: 10, avgCost: 1, currentValue: 4000 }],
        },
      ],
      liabilities: [],
      transactions: [],
      accounts: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    expect(m.get('g1')).toBeCloseTo(4000, 5);
  });

  it('averageRollingMonthlyNetSurplus returns 0 when no transactions', () => {
    expect(averageRollingMonthlyNetSurplus(null)).toBe(0);
  });

  it('averageRollingMonthlyNetSurplus converts USD account flows to SAR before averaging', () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
          type: 'income',
          category: 'Salary',
        },
      ],
    } as unknown as FinancialData;
    const avg = averageRollingMonthlyNetSurplus(data, 1, 3.75);
    expect(avg).toBeCloseTo(375, 5);
  });

  it('includes idle Investment platform cash for goal-linked portfolios (once per account)', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'House',
      targetAmount: 100000,
      deadline: '2030-01-01',
      priority: 'High',
    };
    const data = {
      goals: [goal],
      assets: [],
      accounts: [
        { id: 'acc-inv', name: 'Broker', type: 'Investment', balance: 4000, currency: 'SAR' },
      ],
      investments: [
        {
          id: 'p1',
          name: 'Core',
          accountId: 'acc-inv',
          goalId: 'g1',
          currency: 'SAR' as const,
          holdings: [{ id: 'h1', symbol: 'STOCK', quantity: 1, avgCost: 10, currentValue: 3000 }],
        },
      ],
      liabilities: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    // Holdings 3000 + platform cash 4000
    expect(m.get('g1')).toBeCloseTo(7000, 5);
  });

  it('splits platform cash across goals by linked holding weights; counts cash once on multi-portfolio platform', () => {
    const goals: Goal[] = [
      { id: 'gA', name: 'A', targetAmount: 100000, currentAmount: 0, deadline: '2030-01-01', priority: 'High' },
      { id: 'gB', name: 'B', targetAmount: 100000, currentAmount: 0, deadline: '2030-01-01', priority: 'High' },
    ];
    const data = {
      goals,
      assets: [],
      accounts: [
        { id: 'acc-inv', name: 'Broker', type: 'Investment', balance: 1000, currency: 'SAR' },
      ],
      investments: [
        {
          id: 'p1',
          name: 'A sleeve',
          accountId: 'acc-inv',
          goalId: 'gA',
          currency: 'SAR' as const,
          holdings: [{ id: 'h1', symbol: 'X', quantity: 1, avgCost: 1, currentValue: 1000, realizedPnL: 0 }],
        },
        {
          id: 'p2',
          name: 'B sleeve',
          accountId: 'acc-inv',
          goalId: 'gB',
          currency: 'SAR' as const,
          holdings: [{ id: 'h2', symbol: 'Y', quantity: 1, avgCost: 1, currentValue: 3000, realizedPnL: 0 }],
        },
      ],
      liabilities: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    // Holdings: A 1000, B 3000. Cash 1000 split 1:3 → A 250, B 750.
    expect(m.get('gA')).toBeCloseTo(1000 + 250, 5);
    expect(m.get('gB')).toBeCloseTo(3000 + 750, 5);
    expect((m.get('gA') ?? 0) + (m.get('gB') ?? 0)).toBeCloseTo(5000, 5);
  });

  it('ignores platform cash when portfolios/holdings have no goal link', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'House',
      targetAmount: 100000,
      deadline: '2030-01-01',
      priority: 'High',
    };
    const data = {
      goals: [goal],
      assets: [{ id: 'a1', name: 'Gold', value: 500, goalId: 'g1' }],
      accounts: [
        { id: 'acc-inv', name: 'Broker', type: 'Investment', balance: 9000, currency: 'SAR' },
      ],
      investments: [
        {
          id: 'p1',
          name: 'Unlinked',
          accountId: 'acc-inv',
          currency: 'SAR' as const,
          holdings: [{ id: 'h1', symbol: 'STOCK', quantity: 1, avgCost: 10, currentValue: 3000 }],
        },
      ],
      liabilities: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;

    const m = computeGoalResolvedAmountsSar(data, 3.75);
    expect(m.get('g1')).toBeCloseTo(500, 5);
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
