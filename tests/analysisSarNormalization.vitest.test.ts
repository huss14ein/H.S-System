import { describe, it, expect } from 'vitest';
import {
  spendByMerchantSar,
  expenseTotalsByBudgetCategorySar,
  findRefundPairsSar,
} from '../services/transactionIntelligence';
import { salaryToExpenseCoverageSar } from '../services/salaryExpenseCoverage';
import type { Account, Transaction } from '../types';

describe('Analysis SAR normalization', () => {
  const sarPerUsd = 3.75;

  it('aggregates merchants in SAR across USD and SAR accounts', () => {
    const accounts: Account[] = [
      { id: 'a1', name: 'SAR chk', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
      { id: 'a2', name: 'USD chk', type: 'Checking', balance: 0, currency: 'USD' } as Account,
    ];
    const transactions = [
      {
        id: 't1',
        date: '2026-01-15',
        description: 'STORE ONE',
        amount: -100,
        type: 'expense',
        category: 'Food',
        accountId: 'a1',
      },
      {
        id: 't2',
        date: '2026-02-10',
        description: 'STORE ONE',
        amount: -40,
        type: 'expense',
        category: 'Food',
        accountId: 'a2',
      },
    ] as Transaction[];

    const rows = spendByMerchantSar(transactions, accounts, sarPerUsd, { months: 6 });
    const one = rows.find((r) => r.merchant.includes('STORE'));
    expect(one).toBeDefined();
    expect(one!.total).toBeCloseTo(100 + 40 * 3.75, 4);
  });

  it('sums budget categories in SAR', () => {
    const accounts: Account[] = [{ id: 'u', name: 'USD', type: 'Checking', balance: 0, currency: 'USD' } as Account];
    const transactions = [
      {
        id: 't1',
        date: '2026-03-01',
        description: 'x',
        amount: -200,
        type: 'expense',
        budgetCategory: 'Housing',
        accountId: 'u',
      },
    ] as Transaction[];
    const cat = expenseTotalsByBudgetCategorySar(transactions, accounts, sarPerUsd);
    expect(cat[0]?.value).toBeCloseTo(750, 4);
  });

  it('matches refund pairs on SAR equivalence across currencies', () => {
    const accounts: Account[] = [
      { id: 'sar', name: 's', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
      { id: 'usd', name: 'u', type: 'Checking', balance: 0, currency: 'USD' } as Account,
    ];
    const transactions = [
      {
        id: 'e1',
        date: '2026-04-01',
        description: 'purchase refund test',
        amount: -375,
        type: 'expense',
        category: 'x',
        accountId: 'sar',
      },
      {
        id: 'i1',
        date: '2026-04-03',
        description: 'refund credit',
        amount: 100,
        type: 'income',
        category: 'x',
        accountId: 'usd',
      },
    ] as Transaction[];
    const pairs = findRefundPairsSar(transactions, accounts, sarPerUsd, 14, 2);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]!.amount).toBeCloseTo(375, 4);
  });

  it('uses SAR for salary vs expense coverage', () => {
    const accounts: Account[] = [
      { id: 's', name: 's', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
    ];
    const txs: Transaction[] = [
      { id: 'i1', date: '2026-01-05', description: 'salary', amount: 10000, type: 'income', category: 'Salary', accountId: 's' },
      { id: 'i2', date: '2026-02-05', description: 'salary', amount: 10000, type: 'income', category: 'Salary', accountId: 's' },
      { id: 'i3', date: '2026-03-05', description: 'salary', amount: 10000, type: 'income', category: 'Salary', accountId: 's' },
      { id: 'e1', date: '2026-01-10', description: 'rent', amount: -3000, type: 'expense', category: 'Housing', accountId: 's' },
      { id: 'e2', date: '2026-02-10', description: 'rent', amount: -3000, type: 'expense', category: 'Housing', accountId: 's' },
      { id: 'e3', date: '2026-03-10', description: 'rent', amount: -3000, type: 'expense', category: 'Housing', accountId: 's' },
    ] as Transaction[];
    const cov = salaryToExpenseCoverageSar(txs, accounts, sarPerUsd, 6);
    expect(cov.ratio).not.toBeNull();
    expect(cov.ratio!).toBeGreaterThan(1);
  });
});
