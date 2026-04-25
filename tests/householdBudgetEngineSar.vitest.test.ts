import { describe, expect, it } from 'vitest';
import { accumulateHouseholdYearCashflowSar, sumLiquidCash } from '../services/householdBudgetEngine';
import type { FinancialData } from '../types';

describe('householdBudgetEngine SAR', () => {
  it('sumLiquidCash converts USD checking balances', () => {
    const accounts = [
      { type: 'Checking' as const, balance: 1000, currency: 'USD' as const },
      { type: 'Savings' as const, balance: 5000, currency: 'SAR' as const },
    ];
    expect(sumLiquidCash(accounts, 3.75)).toBeCloseTo(8750, 5);
  });

  it('accumulateHouseholdYearCashflowSar converts USD income using account currency', () => {
    const year = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = `${year}-${m}-10`;
    const data = {
      goals: [],
      assets: [],
      investments: [],
      liabilities: [],
      budgets: [],
      accounts: [{ id: 'u1', type: 'Checking', currency: 'USD', balance: 0 }],
      transactions: [
        {
          id: 't1',
          date: day,
          accountId: 'u1',
          amount: 200,
          type: 'Income',
          category: 'Salary',
        },
      ],
    } as unknown as FinancialData;
    const { monthlyIncome } = accumulateHouseholdYearCashflowSar(data, data.transactions as any, data.accounts as any, year, 3.75);
    const monthIdx = new Date(day).getMonth();
    expect(monthlyIncome[monthIdx]).toBeCloseTo(750, 5);
  });
});
