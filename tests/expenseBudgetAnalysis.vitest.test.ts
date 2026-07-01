import { describe, expect, it } from 'vitest';
import { computeExpenseBudgetAnalysisModel } from '../services/expenseBudgetAnalysisModel';
import type { FinancialData } from '../types';

describe('computeExpenseBudgetAnalysisModel', () => {
  const ref = new Date(2026, 5, 15); // June 2026

  it('builds category rows with budget utilization and insights', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 5000, currency: 'SAR' }],
      budgets: [
        { id: 'b1', category: 'Food', limit: 2000, month: 6, year: 2026, period: 'monthly', tier: 'Core' },
        { id: 'b2', category: 'Travel', limit: 500, month: 6, year: 2026, period: 'monthly', tier: 'Optional' },
      ],
      transactions: [
        {
          id: 't1',
          date: '2026-06-10',
          description: 'Grocery',
          amount: -800,
          category: 'Groceries',
          budgetCategory: 'Food',
          type: 'expense',
          expenseType: 'Core',
          transactionNature: 'Variable',
          accountId: 'a1',
          status: 'Approved',
        },
        {
          id: 't2',
          date: '2026-06-12',
          description: 'Flight',
          amount: -700,
          category: 'Travel',
          budgetCategory: 'Travel',
          type: 'expense',
          expenseType: 'Discretionary',
          transactionNature: 'Variable',
          accountId: 'a1',
          status: 'Approved',
        },
        {
          id: 't3',
          date: '2026-06-01',
          description: 'Salary',
          amount: 12000,
          category: 'Salary',
          type: 'income',
          accountId: 'a1',
          status: 'Approved',
        },
      ],
    } as unknown as FinancialData;

    const model = computeExpenseBudgetAnalysisModel(data, 3.75, ref);
    expect(model).not.toBeNull();
    expect(model!.summary.expenseSar).toBeCloseTo(1500, 0);
    expect(model!.summary.incomeSar).toBeCloseTo(12000, 0);
    expect(model!.summary.budgetedSar).toBeCloseTo(2500, 0);
    expect(model!.summary.budgetVarianceSar).toBeCloseTo(1000, 0);

    const food = model!.categories.find((c) => c.category === 'Food');
    expect(food?.spentSar).toBeCloseTo(800, 0);
    expect(food?.utilizationPct).toBeCloseTo(40, 0);
    expect(food?.status).toBe('healthy');

    const travel = model!.categories.find((c) => c.category === 'Travel');
    expect(travel?.status).toBe('over');
    expect(model!.overBudgetCategories.some((c) => c.category === 'Travel')).toBe(true);
    expect(model!.insights.some((i) => i.category === 'Travel')).toBe(true);
    expect(model!.byExpenseType.some((x) => x.label === 'Core')).toBe(true);
    expect(model!.topTransactions.length).toBeGreaterThan(0);
    expect(model!.monthlyTrend.length).toBe(6);
  });

  it('uncategorized spend in data quality', () => {
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' }],
      budgets: [],
      transactions: [
        {
          id: 't1',
          date: '2026-06-05',
          description: 'Unknown',
          amount: -300,
          category: '',
          type: 'expense',
          accountId: 'a1',
          status: 'Approved',
        },
      ],
    } as unknown as FinancialData;

    const model = computeExpenseBudgetAnalysisModel(data, 3.75, ref);
    expect(model!.dataQuality.some((d) => d.code === 'uncategorized')).toBe(true);
  });
});

describe('Analysis page wiring', () => {
  it('includes expense budget analysis panel', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('pages/Analysis.tsx', 'utf8');
    const panel = readFileSync('components/analysis/ExpenseBudgetAnalysisPanel.tsx', 'utf8');
    const hook = readFileSync('hooks/useExpenseBudgetAnalysisModel.ts', 'utf8');
    expect(page).toContain('ExpenseBudgetAnalysisPanel');
    expect(page).toContain('useExpenseBudgetAnalysisModel');
    expect(page).toContain('DeferredMount');
    expect(page).not.toContain('computeExpenseBudgetAnalysisModel');
    expect(panel).toContain('expense-budget-analysis');
    expect(panel).toContain('model: ExpenseBudgetAnalysisModel');
    expect(panel).toContain('scheduleIdleWork');
    expect(hook).toContain('scheduleIdleWorkAsync');
    expect(hook).toContain('useDeferredValue');
  });
});
