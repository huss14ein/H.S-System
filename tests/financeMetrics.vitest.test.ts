import { describe, expect, it } from 'vitest';
import { normalizedMonthlyExpenseSar } from '../services/financeMetrics';
import type { Account, Transaction } from '../types';

describe('normalizedMonthlyExpenseSar', () => {
  const sarPerUsd = 3.75;
  const accounts: Account[] = [
    { id: 'a-sar', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' },
    { id: 'a-usd', name: 'USD', type: 'Checking', balance: 0, currency: 'USD' },
  ];

  it('converts USD account expenses to SAR before averaging by month', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = `${y}-${m}-15`;
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
    const avg = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1 });
    expect(avg).toBeCloseTo((100 * 3.75 + 400) / 1, 5);
  });
});
