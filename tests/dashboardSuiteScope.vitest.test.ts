import { describe, expect, it } from 'vitest';
import { personalMonthlyInflowOutflowByFinancialMonthSar } from '../services/financeMetrics';
import { aggregatePersonalBudgetCategorySpendSar } from '../services/budgetSpendMath';
import { financialMonthKey } from '../utils/financialMonth';
import type { FinancialData } from '../types';

describe('dashboard suite canonical helpers', () => {
  it('personalMonthlyInflowOutflowByFinancialMonthSar returns aligned month keys', () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const data = {
      settings: { monthStartDay: 1 },
      accounts: [{ id: 'a1', type: 'Checking', currency: 'SAR', balance: 0 }],
      transactions: [
        { id: 't1', date: day, amount: 1000, type: 'income', category: 'Salary', accountId: 'a1', status: 'Approved' },
        { id: 't2', date: day, amount: -200, type: 'expense', category: 'Food', accountId: 'a1', status: 'Approved' },
      ],
    } as unknown as FinancialData;
    const series = personalMonthlyInflowOutflowByFinancialMonthSar(data, 3.75, 3);
    expect(series.monthKeys.length).toBe(3);
    expect(series.inflow.length).toBe(3);
    expect(series.outflow.length).toBe(3);
    const fk = financialMonthKey(new Date(`${day}T12:00:00`), 1);
    const label = `${fk.year}-${String(fk.month).padStart(2, '0')}`;
    const row = series.byKey.get(label);
    expect(row?.inflow).toBe(1000);
    expect(row?.outflow).toBe(200);
  });

  it('aggregatePersonalBudgetCategorySpendSar respects budget category splits', () => {
    const data = { settings: { monthStartDay: 1 } } as FinancialData;
    const accounts = [{ id: 'a1', type: 'Checking', currency: 'SAR' as const, balance: 0 }];
    const start = new Date(2026, 4, 1);
    const end = new Date(2026, 4, 31, 23, 59, 59, 999);
    const txs = [
      {
        id: 'e1',
        date: '2026-05-15',
        amount: -100,
        type: 'expense',
        status: 'Approved',
        accountId: 'a1',
        budgetCategory: 'Food',
      },
    ];
    const map = aggregatePersonalBudgetCategorySpendSar(txs, start, end, new Map([['a1', 'SAR']]), data, 3.75);
    expect(map.get('Food')).toBe(100);
  });
});
