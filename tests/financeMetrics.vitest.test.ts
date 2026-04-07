import { describe, expect, it } from 'vitest';
import { normalizedMonthlyExpense, normalizedMonthlyExpenseSar } from '../services/financeMetrics';
import type { Account, Transaction } from '../types';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

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
    const endOfMonth = new Date(y, now.getMonth() + 1, 0, 23, 59, 59, 999);
    const avg = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1, endDate: endOfMonth });
    expect(avg).toBeCloseTo((100 * 3.75 + 400) / 1, 5);
  });

  it('excludes future-dated expenses in the current month by default', () => {
    const now = new Date();
    const future = addDays(now, 2);

    const txs: Transaction[] = [
      {
        id: 'past',
        date: toIsoDate(now),
        description: 'past',
        amount: -100,
        category: 'Food',
        accountId: 'a-sar',
        type: 'expense',
      },
      {
        id: 'future',
        date: toIsoDate(future),
        description: 'future',
        amount: -900,
        category: 'Food',
        accountId: 'a-sar',
        type: 'expense',
      },
    ];

    const avg = normalizedMonthlyExpenseSar(txs, accounts, sarPerUsd, { monthsLookback: 1, endDate: now });
    expect(avg).toBeCloseTo(100, 5);
  });
});

describe('normalizedMonthlyExpense', () => {
  it('excludes future-dated expenses in the current month when endDate is now', () => {
    const now = new Date();
    const future = addDays(now, 2);

    const txs = [
      { date: toIsoDate(now), amount: -120, type: 'expense', category: 'Food' },
      { date: toIsoDate(future), amount: -880, type: 'expense', category: 'Food' },
    ];

    const avg = normalizedMonthlyExpense(txs, { monthsLookback: 1, endDate: now });
    expect(avg).toBeCloseTo(120, 5);
  });

  it('treats YYYY-MM-DD transaction dates as calendar days vs endDate day boundary', () => {
    const endDate = new Date();
    const tomorrow = addDays(endDate, 1);
    const txs = [
      { date: toIsoDate(endDate), amount: -200, type: 'expense', category: 'Food' },
      { date: toIsoDate(tomorrow), amount: -500, type: 'expense', category: 'Food' },
    ];
    const avg = normalizedMonthlyExpense(txs, { monthsLookback: 1, endDate });
    expect(avg).toBeCloseTo(200, 5);
  });
});
