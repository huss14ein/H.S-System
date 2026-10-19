import { describe, expect, it } from 'vitest';
import { detectSpendingAnomaliesFromTransactions } from '../services/householdBudgetAnalytics';
import type { Budget } from '../types';

describe('detectSpendingAnomaliesFromTransactions', () => {
  const year = 2026;
  const accounts = [{ id: 'a1', currency: 'SAR' }];

  it('flags a month that is an outlier vs other months for the same category', () => {
    const transactions = [
      { date: '2026-01-15', amount: -1000, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'housing', category: 'x' },
      { date: '2026-02-10', amount: -1100, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'housing', category: 'x' },
      { date: '2026-03-05', amount: -900, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'housing', category: 'x' },
      { date: '2026-04-20', amount: -5000, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'housing', category: 'x' },
    ];
    const rows = detectSpendingAnomaliesFromTransactions({
      year,
      transactions,
      accounts,
      sarPerUsd: 3.75,
      monthStartDay: 1,
    });
    const apr = rows.find((r) => r.month === 4 && r.category === 'housing');
    expect(apr).toBeDefined();
    expect(apr!.actualAmount).toBeGreaterThan(apr!.expectedAmount);
  });

  it('produces per-category expected amounts (not a single template scaled to total expense)', () => {
    const transactions = [
      { date: '2026-01-15', amount: -500, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'groceries' },
      { date: '2026-02-10', amount: -520, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'groceries' },
      { date: '2026-03-05', amount: -480, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'groceries' },
      { date: '2026-04-12', amount: -3000, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'groceries' },
      { date: '2026-01-20', amount: -200, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'fuel' },
      { date: '2026-02-18', amount: -210, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'fuel' },
      { date: '2026-03-22', amount: -190, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'fuel' },
      { date: '2026-04-28', amount: -900, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'fuel' },
    ];
    const rows = detectSpendingAnomaliesFromTransactions({
      year,
      transactions,
      accounts,
      sarPerUsd: 3.75,
      monthStartDay: 1,
    });
    const g = rows.find((r) => r.month === 4 && r.category === 'groceries');
    const f = rows.find((r) => r.month === 4 && r.category === 'fuel');
    expect(g && f).toBeTruthy();
    expect(g!.expectedAmount).toBeCloseTo(500, 0);
    expect(f!.expectedAmount).toBeCloseTo(200, 0);
  });

  it('does not flag Housing Rent outliers while YTD is within the yearly plan', () => {
    const rentYearly = {
      id: 'br',
      category: 'Housing Rent',
      limit: 18000,
      period: 'yearly',
      month: 1,
      year: 2026,
    } as Budget;
    // Three small "baseline" months + one large semi-annual payment still within 18k YTD.
    const transactions = [
      { date: '2026-01-15', amount: -100, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'Housing Rent' },
      { date: '2026-02-10', amount: -100, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'Housing Rent' },
      { date: '2026-03-05', amount: -100, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'Housing Rent' },
      { date: '2026-04-20', amount: -9000, type: 'expense', accountId: 'a1', status: 'Approved', budgetCategory: 'Housing Rent' },
    ];
    const withoutBudgets = detectSpendingAnomaliesFromTransactions({
      year,
      transactions,
      accounts,
      sarPerUsd: 3.75,
      monthStartDay: 1,
    });
    expect(withoutBudgets.some((r) => r.category === 'Housing Rent' && r.month === 4)).toBe(true);

    const withYearlyPlan = detectSpendingAnomaliesFromTransactions({
      year,
      transactions,
      accounts,
      sarPerUsd: 3.75,
      monthStartDay: 1,
      budgets: [rentYearly],
    });
    expect(withYearlyPlan.some((r) => r.category === 'Housing Rent')).toBe(false);
  });
});
