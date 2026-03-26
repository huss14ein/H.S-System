import { describe, it, expect } from 'vitest';
import { buildAnnualPlanRows, isIncomeLikeBudgetCategory, resolvePlannedIncomeForMonth } from '../services/annualPlanFromData';
import type { Budget, RecurringTransaction } from '../types';

describe('annualPlanFromData', () => {
  it('does not double-count recurring income on top of expected salary', () => {
    const budgets: Budget[] = [];
    const transactions: { date: string; type?: string; amount?: number; category?: string }[] = [];
    const recurring: RecurringTransaction[] = [
      {
        id: 'r1',
        description: 'Salary',
        amount: 10000,
        type: 'income',
        accountId: 'a1',
        category: 'Salary',
        dayOfMonth: 1,
        enabled: true,
      },
    ];
    const { rows, incomeMeta } = buildAnnualPlanRows({
      year: 2025,
      budgets,
      transactions,
      recurringTransactions: recurring,
      investmentPlan: { monthlyBudget: 0 } as any,
      investmentTransactions: [],
      accounts: [],
      investments: [],
      personalAccountIds: new Set(),
      data: null,
      exchangeRate: 3.75,
      sarPerUsd: 3.75,
      expectedMonthlySalary: 10000,
      householdOverrides: [],
    });
    const income = rows.find((r) => r.type === 'income');
    expect(income).toBeDefined();
    expect(income!.monthly_planned[0]).toBe(10000);
    expect(incomeMeta.recurringIncomeMonthlySum).toBe(10000);
  });

  it('classifies salary budget as income-like', () => {
    expect(isIncomeLikeBudgetCategory('Salary')).toBe(true);
    expect(isIncomeLikeBudgetCategory('Food')).toBe(false);
  });

  it('resolvePlannedIncomeForMonth prefers override then actual', () => {
    const incomeActuals = Array(12).fill(0);
    incomeActuals[2] = 5000;
    const ovr = new Map<number, number>([[1, 999]]);
    expect(
      resolvePlannedIncomeForMonth({
        monthIndex: 1,
        incomeActuals,
        overrideByMonth: ovr,
        expectedMonthlySalary: 100,
        budgetIncomePlanned: Array(12).fill(0),
        recurringIncomeMonthlySum: 0,
        incomeAvg: 0,
        suggestedMonthlySalary: 0,
      }),
    ).toBe(999);
    expect(
      resolvePlannedIncomeForMonth({
        monthIndex: 2,
        incomeActuals,
        overrideByMonth: new Map(),
        expectedMonthlySalary: 100,
        budgetIncomePlanned: Array(12).fill(0),
        recurringIncomeMonthlySum: 0,
        incomeAvg: 0,
        suggestedMonthlySalary: 0,
      }),
    ).toBe(5000);
  });
});
