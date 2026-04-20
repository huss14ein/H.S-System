import { describe, expect, it, vi, afterEach } from 'vitest';
import * as goalResolvedTotals from '../services/goalResolvedTotals';
import {
  budgetMonthlyEquivalentSar,
  computeGoalMonthlyFundingEnvelopeSar,
  goalMonthlyInvestmentContributionSar,
  rollingSurplusAfterAllGoalBudgetReservations,
} from '../services/goalProjectionFunding';
import type { FinancialData, Goal, Budget, InvestmentTransaction, InvestmentPortfolio } from '../types';

describe('goalProjectionFunding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('budgetMonthlyEquivalentSar converts yearly to monthly', () => {
    const b = { id: '1', category: 'X', limit: 12000, month: 1, year: 2026, period: 'yearly' as const };
    expect(budgetMonthlyEquivalentSar(b)).toBeCloseTo(1000, 5);
  });

  it('adds assigned budget and allocation slice using surplus after other goal budgets', () => {
    vi.spyOn(goalResolvedTotals, 'averageRollingMonthlyNetSurplus').mockReturnValue(5000);

    const g1: Goal = {
      id: 'g1',
      name: 'Home',
      targetAmount: 100000,
      currentAmount: 0,
      deadline: '2030-01-01',
      priority: 'High',
      savingsAllocationPercent: 40,
    };
    const budgets: Budget[] = [
      { id: 'b1', category: 'Save', limit: 2000, month: 4, year: 2026, period: 'monthly', goalId: 'g1' },
    ];
    const data = {
      goals: [g1],
      budgets,
      transactions: [],
      accounts: [],
      liabilities: [],
      investments: [],
      assets: [],
    } as unknown as FinancialData;

    const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g1, data });
    expect(env.assignedBudgetMonthly).toBeCloseTo(2000, 5);
    expect(env.assignedInvestmentMonthly).toBeCloseTo(0, 5);
    /** Only budgets linked to *other* goals reduce the slice base. */
    expect(env.reservedByOtherGoalBudgets).toBeCloseTo(0, 5);
    expect(env.allocationSliceMonthly).toBeCloseTo(5000 * 0.4, 5);
    expect(env.envelopeMonthly).toBeCloseTo(2000 + 5000 * 0.4, 5);
  });

  it('includes rolling average of goal-linked investment deposits in assigned envelope', () => {
    vi.spyOn(goalResolvedTotals, 'averageRollingMonthlyNetSurplus').mockReturnValue(4000);

    const g1: Goal = {
      id: 'g-house',
      name: 'House',
      targetAmount: 500000,
      currentAmount: 0,
      deadline: '2035-01-01',
      priority: 'High',
      savingsAllocationPercent: 25,
    };

    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'pf1',
        name: 'Inv',
        accountId: 'acc1',
        currency: 'SAR',
        goalId: 'g-house',
        holdings: [],
      },
    ];

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');

    const investmentTransactions: InvestmentTransaction[] = [
      {
        id: 'tx1',
        accountId: 'acc1',
        portfolioId: 'pf1',
        date: `${y}-${m}-${d}`,
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: 3000,
        currency: 'SAR',
      },
    ];

    const data = {
      goals: [g1],
      budgets: [],
      transactions: [],
      accounts: [],
      liabilities: [],
      investments: portfolios,
      investmentTransactions,
      assets: [],
    } as unknown as FinancialData;

    expect(goalMonthlyInvestmentContributionSar('g-house', data, 3.75)).toBeGreaterThan(0);

    const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g1, data, sarPerUsd: 3.75 });
    expect(env.assignedInvestmentMonthly).toBeGreaterThan(0);
    expect(env.envelopeMonthly).toBeCloseTo(env.assignedInvestmentMonthly + env.allocationSliceMonthly, 5);
  });

  it('reservedByOtherGoalBudgets excludes this goal but includes other goals', () => {
    vi.spyOn(goalResolvedTotals, 'averageRollingMonthlyNetSurplus').mockReturnValue(5000);
    const g1: Goal = {
      id: 'g1',
      name: 'Home',
      targetAmount: 100000,
      currentAmount: 0,
      deadline: '2030-01-01',
      priority: 'High',
      savingsAllocationPercent: 50,
    };
    const budgets: Budget[] = [
      { id: 'b1', category: 'Trip', limit: 1000, month: 1, year: 2026, period: 'monthly', goalId: 'g_other' },
      { id: 'b2', category: 'Save', limit: 500, month: 1, year: 2026, period: 'monthly', goalId: 'g1' },
    ];
    const data = {
      goals: [g1],
      budgets,
      transactions: [],
      accounts: [],
      liabilities: [],
      investments: [],
      assets: [],
    } as unknown as FinancialData;

    const env = computeGoalMonthlyFundingEnvelopeSar({ goal: g1, data });
    expect(env.reservedByOtherGoalBudgets).toBeCloseTo(1000, 5);
    expect(env.assignedBudgetMonthly).toBeCloseTo(500, 5);
    expect(env.allocationSliceMonthly).toBeCloseTo((5000 - 1000) * 0.5, 5);
  });

  it('rollingSurplusAfterAllGoalBudgetReservations subtracts all goal-tagged budgets', () => {
    vi.spyOn(goalResolvedTotals, 'averageRollingMonthlyNetSurplus').mockReturnValue(10000);
    const data = {
      budgets: [
        { id: 'b1', category: 'A', limit: 1000, month: 1, year: 2026, goalId: 'g1' },
        { id: 'b2', category: 'B', limit: 500, month: 1, year: 2026, goalId: 'g2' },
      ],
    } as unknown as FinancialData;
    expect(rollingSurplusAfterAllGoalBudgetReservations(data)).toBeCloseTo(8500, 5);
  });
});
