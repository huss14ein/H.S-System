import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../types';
import { summarizeZakatableCashForZakat } from '../services/zakatCashValuation';

const SAR_PER_USD = 3.75;

describe('summarizeZakatableCashForZakat', () => {
  it('counts no zakatable cash when balance exists but there is no transaction history', () => {
    const accounts: Account[] = [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 10_000, currency: 'SAR' }];
    const { totalSar, grossTotalSar, lines } = summarizeZakatableCashForZakat(accounts, [], SAR_PER_USD);
    expect(grossTotalSar).toBeCloseTo(10_000, 5);
    expect(totalSar).toBe(0);
    expect(lines[0]?.zakatableValueSar).toBe(0);
    expect(lines[0]?.lots[0]?.hawlEligible).toBe(false);
  });

  it('defers zakatable amount until lunar hawl completes from deposit date', () => {
    const accounts: Account[] = [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 5_000, currency: 'SAR' }];
    const txs: Transaction[] = [
      {
        id: 't1',
        date: '2025-06-01',
        description: 'Salary',
        amount: 5_000,
        category: 'Salary',
        accountId: 'a1',
        type: 'income',
      },
    ];
    const asOf = new Date('2025-12-01T12:00:00.000Z');
    const { totalSar, lines } = summarizeZakatableCashForZakat(accounts, txs, SAR_PER_USD, asOf);
    expect(lines[0]?.zakatableValueSar).toBe(0);
    expect(totalSar).toBe(0);
    expect(lines[0]?.lots[0]?.hawlEligible).toBe(false);
  });

  it('includes cash after 354 days from deposit', () => {
    const accounts: Account[] = [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 5_000, currency: 'SAR' }];
    const txs: Transaction[] = [
      {
        id: 't1',
        date: '2024-01-01',
        description: 'Salary',
        amount: 5_000,
        category: 'Salary',
        accountId: 'a1',
        type: 'income',
      },
    ];
    const asOf = new Date('2025-12-01T12:00:00.000Z');
    const { totalSar, lines } = summarizeZakatableCashForZakat(accounts, txs, SAR_PER_USD, asOf);
    expect(lines[0]?.zakatableValueSar).toBeCloseTo(5_000, 5);
    expect(totalSar).toBeCloseTo(5_000, 5);
    expect(lines[0]?.lots[0]?.hawlEligible).toBe(true);
  });

  it('consumes oldest deposit layers first on spending (FIFO)', () => {
    const accounts: Account[] = [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 3_000, currency: 'SAR' }];
    const txs: Transaction[] = [
      {
        id: 't1',
        date: '2024-01-01',
        description: 'In',
        amount: 5_000,
        category: 'Income',
        accountId: 'a1',
        type: 'income',
      },
      {
        id: 't2',
        date: '2025-06-01',
        description: 'Spend',
        amount: -2_000,
        category: 'Food',
        accountId: 'a1',
        type: 'expense',
      },
    ];
    const asOf = new Date('2025-12-01T12:00:00.000Z');
    const { totalSar, lines } = summarizeZakatableCashForZakat(accounts, txs, SAR_PER_USD, asOf);
    expect(lines[0]?.lots).toHaveLength(1);
    expect(lines[0]?.lots[0]?.amountBook).toBeCloseTo(3_000, 5);
    expect(lines[0]?.zakatableValueSar).toBeCloseTo(3_000, 5);
    expect(totalSar).toBeCloseTo(3_000, 5);
  });
});
