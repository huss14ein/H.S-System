import { describe, expect, it } from 'vitest';
import { canPostTransactionToAccount } from '../services/dataQuality/accountPostingPolicy';
import type { Account } from '../types';

describe('canPostTransactionToAccount', () => {
  it('allows any posting on credit accounts (exception)', () => {
    const credit = { id: 'cc1', type: 'Credit', balance: -5000 } as Account;
    expect(canPostTransactionToAccount(credit).allowed).toBe(true);
  });

  it('blocks non-credit accounts with zero or negative balances', () => {
    const checkingZero = { id: 'a1', type: 'Checking', balance: 0 } as Account;
    const savingsNeg = { id: 'a2', type: 'Savings', balance: -1 } as Account;
    expect(canPostTransactionToAccount(checkingZero).allowed).toBe(false);
    expect(canPostTransactionToAccount(savingsNeg).allowed).toBe(false);
  });

  it('allows non-credit accounts only when balance is strictly positive', () => {
    const checking = { id: 'a3', type: 'Checking', balance: 0.01 } as Account;
    expect(canPostTransactionToAccount(checking).allowed).toBe(true);
  });

  it('blocks posting when account is missing', () => {
    expect(canPostTransactionToAccount(undefined).allowed).toBe(false);
  });
});
