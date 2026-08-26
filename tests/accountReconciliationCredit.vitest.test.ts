import { describe, expect, it } from 'vitest';
import { reconcileCreditAccountBalance, transactionNetForAccount } from '../services/dataQuality/accountReconciliation';
import type { Account, Transaction } from '../types';

describe('reconcileCreditAccountBalance', () => {
  const credit: Account = { id: 'cc-1', name: 'Visa', type: 'Credit', balance: -360 } as Account;

  const txs: Transaction[] = [
    { id: 't1', date: '2026-04-01', description: 'Coffee', amount: -25, type: 'expense', category: 'Food', accountId: 'cc-1' } as Transaction,
    { id: 't2', date: '2026-04-02', description: 'Fuel', amount: -90, type: 'expense', category: 'Transport', accountId: 'cc-1' } as Transaction,
    { id: 't3', date: '2026-04-03', description: 'Card payment', amount: 200, type: 'income', category: 'Transfer', accountId: 'cc-1' } as Transaction,
    { id: 't4', date: '2026-04-04', description: 'Chargeback reversal', amount: -15, type: 'expense', category: 'Fee', accountId: 'cc-1' } as Transaction,
    { id: 't5', date: '2026-04-04', description: 'Fraud dispute in progress', amount: -5, type: 'expense', category: 'Other', accountId: 'cc-1' } as Transaction,
    { id: 'x1', date: '2026-04-04', description: 'Other account', amount: -999, type: 'expense', category: 'Other', accountId: 'chk-1' } as Transaction,
  ];

  it('includes all linked transactions and allows negative balances', () => {
    expect(transactionNetForAccount('cc-1', txs)).toBe(65);
    const rec = reconcileCreditAccountBalance(credit, txs);
    expect(rec).not.toBeNull();
    expect(rec?.txCount).toBe(5);
    expect(rec?.storedBalance).toBe(-360);
    expect(rec?.transactionNet).toBe(65);
    expect(rec?.drift).toBe(-425);
    expect(rec?.showWarning).toBe(true);
  });

  it('classifies reversal/dispute hints for exception workflows', () => {
    const rec = reconcileCreditAccountBalance(credit, txs);
    expect(rec?.reversalLikeCount).toBe(1);
    expect(rec?.disputedLikeCount).toBe(1);
  });

  it('includes snake_case account_id rows in net and warning', () => {
    const mixed = [
      { id: 't1', date: '2026-04-01', description: 'A', amount: -100, type: 'expense', category: 'Other', account_id: 'cc-1' },
      { id: 't2', date: '2026-04-02', description: 'B', amount: -50, type: 'expense', category: 'Other', accountId: 'cc-1' },
      { id: 't3', date: '2026-04-03', description: 'Other', amount: -999, type: 'expense', category: 'Other', accountId: 'chk-1' },
    ] as Transaction[];
    expect(transactionNetForAccount('cc-1', mixed)).toBe(-150);
    const rec = reconcileCreditAccountBalance(credit, mixed);
    expect(rec?.txCount).toBe(2);
    expect(rec?.transactionNet).toBe(-150);
    expect(rec?.showWarning).toBe(true);
  });

  it('empty camelCase accountId does not block account_id', () => {
    const txs = [
      {
        id: 't1',
        date: '2026-04-01',
        description: 'Snake only',
        amount: -40,
        type: 'expense',
        category: 'Other',
        accountId: '',
        account_id: 'cc-1',
      },
    ] as unknown as Transaction[];
    expect(transactionNetForAccount('cc-1', txs)).toBe(-40);
  });
});
