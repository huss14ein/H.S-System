import { describe, expect, it } from 'vitest';
import { normalizedMonthlyExpense, normalizedMonthlyExpenseSar } from '../services/financeMetrics';
import type { Account, Transaction } from '../types';

describe('normalizedMonthlyExpenseSar', () => {
  const sarPerUsd = 3.75;
  const accounts: Account[] = [
    { id: 'a-sar', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' },
    { id: 'a-usd', name: 'USD', type: 'Checking', balance: 0, currency: 'USD' },
  ];

  it('converts USD account expenses to SAR before averaging by month', () => {
    const endDate = new Date();
    const y = endDate.getFullYear();
    const m = String(endDate.getMonth() + 1).padStart(2, '0');
    const d = `${y}-${m}-01`;
    const txs: Transaction[] = [
      {
        id: '1',
        date: d,
        description: 'x',
        amount: -100,
        category: 'Food',
        accountId: 'a-usd',
        type: 'expense',
      },
      {
        id: '2',
        date: d,
        description: 'y',
        amount: -400,
        category: 'Food',
        accountId: 'a-sar',
        type: 'expense',
      },
    ];
    const avg = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1, endDate });
    expect(avg).toBeCloseTo((100 * 3.75 + 400) / 1, 5);
  });

  it('excludes future-dated YYYY-MM-DD entries by calendar day, even when UTC parsing lands earlier locally', () => {
    const endDate = new Date(2026, 3, 8, 22, 0, 0);
    const txs: Transaction[] = [
      {
        id: 'today',
        date: '2026-04-08',
        description: 'today expense',
        amount: -100,
        category: 'Food',
        accountId: 'a-sar',
        type: 'expense',
      },
      {
        id: 'future',
        date: '2026-04-09',
        description: 'future expense',
        amount: -250,
        category: 'Food',
        accountId: 'a-sar',
        type: 'expense',
      },
    ];
    const avgSar = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1, endDate });
    const avg = normalizedMonthlyExpense(txs, { monthsLookback: 1, endDate });
    expect(avgSar).toBeCloseTo(100, 5);
    expect(avg).toBeCloseTo(100, 5);
  });
});
