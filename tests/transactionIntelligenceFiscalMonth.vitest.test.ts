import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  expenseTotalsByBudgetCategorySar,
  spendByMerchantSar,
} from '../services/transactionIntelligence';
import type { Account, FinancialData, Transaction } from '../types';

const sarPerUsd = 3.75;
const accounts: Account[] = [
  { id: 'a1', name: 'SAR', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
];

const data = {
  settings: { monthStartDay: 28 },
} as FinancialData;

afterEach(() => {
  vi.useRealTimers();
});

describe('transactionIntelligence fiscal month', () => {
  it('scopes category totals to current financial month when data is passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // Jul 1 → fiscal 2026-06 (Jun 28 – Jul 27)

    const transactions = [
      {
        id: 'in',
        date: '2026-06-29',
        description: 'in period',
        amount: -100,
        type: 'expense',
        budgetCategory: 'Food',
        accountId: 'a1',
      },
      {
        id: 'out',
        date: '2026-06-27',
        description: 'prior period',
        amount: -500,
        type: 'expense',
        budgetCategory: 'Food',
        accountId: 'a1',
      },
    ] as Transaction[];

    const scoped = expenseTotalsByBudgetCategorySar(transactions, accounts, sarPerUsd, { data });
    const all = expenseTotalsByBudgetCategorySar(transactions, accounts, sarPerUsd, { data, scope: 'all' });

    expect(all[0]?.value).toBe(600);
    expect(scoped[0]?.value).toBe(100);
  });

  it('excludes txs before fiscal lookback window when data is passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1));

    const transactions = [
      {
        id: 'old',
        date: '2024-01-01',
        description: 'ANCIENT SHOP',
        amount: -999,
        type: 'expense',
        category: 'Food',
        accountId: 'a1',
      },
      {
        id: 'recent',
        date: '2026-06-29',
        description: 'RECENT SHOP',
        amount: -50,
        type: 'expense',
        category: 'Food',
        accountId: 'a1',
      },
    ] as Transaction[];

    const withData = spendByMerchantSar(transactions, accounts, sarPerUsd, { months: 6, data });

    expect(withData.some((r) => r.merchant.includes('RECENT'))).toBe(true);
    expect(withData.some((r) => r.merchant.includes('ANCIENT'))).toBe(false);
    expect(withData.reduce((s, r) => s + r.total, 0)).toBe(50);
  });
});
