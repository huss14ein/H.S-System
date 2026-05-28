import { describe, expect, it } from 'vitest';
import { detectPlanExpenseOutliers, planExpenseOutlierPageAction } from '../services/planExpenseOutliers';
import type { FinancialData } from '../types';

describe('planExpenseOutliers', () => {
  it('flags dominant large expenses in plan year', () => {
    const data = {
      accounts: [{ id: 'a1', currency: 'SAR', type: 'Checking', name: 'Main', balance: 0 }],
      transactions: [
        { id: 't1', date: '2026-03-15', type: 'expense', amount: 5000, category: 'Food', accountId: 'a1', status: 'Approved' },
        { id: 't2', date: '2026-04-10', type: 'expense', amount: 451000, category: 'Miscellaneous', accountId: 'a1', status: 'Approved' },
      ],
    } as unknown as FinancialData;

    const rows = detectPlanExpenseOutliers({ data, year: 2026, sarPerUsd: 3.75 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].category).toBe('Miscellaneous');
    expect(rows[0].amountSar).toBe(451000);
    expect(rows[0].shareOfYtdExpenses).toBeGreaterThan(0.9);
  });

  it('builds Transactions page action', () => {
    expect(planExpenseOutlierPageAction(2026, 3, 'Housing')).toBe('filter-plan-expense:2026:4:Housing');
  });
});
