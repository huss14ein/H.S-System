/**
 * Expense budget analysis — household, pending, and split-line scenarios.
 */
import { describe, expect, it } from 'vitest';
import { computeExpenseBudgetAnalysisModel } from '../services/expenseBudgetAnalysisModel';
import type { FinancialData } from '../types';

describe('expenseBudgetScenarios', () => {
  const ref = new Date(2026, 5, 15);

  it('excludes pending expenses from approved envelope but tracks pending SAR', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' }],
      budgets: [{ id: 'b1', category: 'Food', limit: 1000, month: 6, year: 2026, period: 'monthly' }],
      transactions: [
        {
          id: 't1',
          date: '2026-06-05',
          description: 'Approved grocery',
          amount: -400,
          category: 'Groceries',
          budgetCategory: 'Food',
          type: 'expense',
          accountId: 'a1',
          status: 'Approved',
        },
        {
          id: 't2',
          date: '2026-06-08',
          description: 'Pending restaurant',
          amount: -200,
          category: 'Dining',
          budgetCategory: 'Food',
          type: 'expense',
          accountId: 'a1',
          status: 'Pending',
        },
      ],
    } as unknown as FinancialData;

    const model = computeExpenseBudgetAnalysisModel(data, 3.75, ref);
    expect(model!.summary.expenseSar).toBeCloseTo(400, 0);
    expect(model!.summary.pendingExpenseSar).toBeCloseTo(200, 0);
    expect(model!.dataQuality.some((d) => d.code === 'pending')).toBe(true);
    const food = model!.categories.find((c) => c.category === 'Food');
    expect(food?.spentSar).toBeCloseTo(400, 0);
  });

  it('household scope includes shared-account transactions not in personal slice', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [
        { id: 'personal', name: 'Mine', type: 'Checking', balance: 0, currency: 'SAR' },
        { id: 'joint', name: 'Joint', type: 'Checking', balance: 0, currency: 'SAR', owner: 'Household' },
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-04',
          description: 'Personal only',
          amount: -100,
          category: 'Food',
          budgetCategory: 'Food',
          type: 'expense',
          accountId: 'personal',
          status: 'Approved',
        },
        {
          id: 't2',
          date: '2026-06-06',
          description: 'Joint utility',
          amount: -300,
          category: 'Utilities',
          budgetCategory: 'Utilities',
          type: 'expense',
          accountId: 'joint',
          status: 'Approved',
        },
      ],
      budgets: [],
    } as unknown as FinancialData;

    const personal = computeExpenseBudgetAnalysisModel(data, 3.75, ref, 'personal');
    const household = computeExpenseBudgetAnalysisModel(data, 3.75, ref, 'household');
    expect(personal!.summary.expenseSar).toBeCloseTo(100, 0);
    expect(household!.summary.expenseSar).toBeCloseTo(400, 0);
  });

  it('split lines allocate spend across budget categories', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' }],
      budgets: [
        { id: 'b1', category: 'Food', limit: 500, month: 6, year: 2026, period: 'monthly' },
        { id: 'b2', category: 'Household', limit: 500, month: 6, year: 2026, period: 'monthly' },
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-10',
          description: 'Costco split',
          amount: -200,
          category: 'Shopping',
          type: 'expense',
          accountId: 'a1',
          status: 'Approved',
          splitLines: [
            { category: 'Food', amount: 120 },
            { category: 'Household', amount: 80 },
          ],
        },
      ],
    } as unknown as FinancialData;

    const model = computeExpenseBudgetAnalysisModel(data, 3.75, ref);
    const food = model!.categories.find((c) => c.category === 'Food');
    const household = model!.categories.find((c) => c.category === 'Household');
    expect(food?.spentSar).toBeCloseTo(120, 0);
    expect(household?.spentSar).toBeCloseTo(80, 0);
    expect(model!.summary.expenseSar).toBeCloseTo(200, 0);
    expect(model!.topTransactions[0]?.isSplit).toBe(true);
  });

  it('cash-in-lieu corporate action computes fractional cash', async () => {
    const { computeCashInLieuDepositSar } = await import('../services/corporateActionApply');
    const cash = computeCashInLieuDepositSar({
      action: {
        type: 'cash_in_lieu',
        ratioNumerator: 1,
        ratioDenominator: 3,
        cashInLieuPrice: 90,
      },
      holding: { quantity: 10, avgCost: 30 },
    });
    // 10 * (1/3) = 3.333… shares → 0 whole, fraction * 90
    expect(cash).toBeGreaterThan(0);
  });
});
