import { describe, expect, it } from 'vitest';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';

describe('canPostTransactionToAccount', () => {
  it('allows credit accounts even when type casing is inconsistent and balance is zero', () => {
    const out = canPostTransactionToAccount({
      id: 'cc-1',
      type: 'credit' as any,
      balance: 0,
    });
    expect(out.allowed).toBe(true);
  });

  it('blocks expenses on non-credit zero-balance accounts', () => {
    const out = canPostTransactionToAccount(
      {
        id: 'chk-1',
        type: 'Checking',
        balance: 0,
      },
      { transactionType: 'expense', category: 'Food & Dining' },
    );
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/Expenses are blocked/i);
  });

  it('allows income (salary) onto zero/negative checking so accounts can be funded', () => {
    const zero = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Income' },
    );
    expect(zero.allowed).toBe(true);

    const negative = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: -50 },
      { transactionType: 'income', category: 'Salary' },
    );
    expect(negative.allowed).toBe(true);
  });

  it('allows inbound transfer income onto zero-balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Transfer' },
    );
    expect(out.allowed).toBe(true);
  });

  it('allows reconciliation adjustment onto zero-balance checking', () => {
    const out = canPostTransactionToAccount(
      { id: 'chk-1', type: 'Checking', balance: 0 },
      { transactionType: 'income', category: 'Reconciliation Adjustment' },
    );
    expect(out.allowed).toBe(true);
  });

  it('blocks expense when transaction type is omitted on zero-balance checking', () => {
    const out = canPostTransactionToAccount({
      id: 'chk-1',
      type: 'Checking',
      balance: 0,
    });
    expect(out.allowed).toBe(false);
  });
});
