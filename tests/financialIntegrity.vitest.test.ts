import { describe, expect, it } from 'vitest';
import { buildFinancialIntegrityReport } from '../services/dataQuality/financialIntegrity';
import type { Account, Transaction } from '../types';

describe('buildFinancialIntegrityReport', () => {
  it('passes clean reconciled data with balanced transfer group', () => {
    const accounts: Account[] = [
      { id: 'chk-1', name: 'Checking', type: 'Checking', balance: -100 } as Account,
      { id: 'sav-1', name: 'Savings', type: 'Savings', balance: 300 } as Account,
    ];
    const txs: Transaction[] = [
      { id: 't1', date: '2026-04-01', description: 'Salary', amount: 1000, type: 'income', category: 'Salary', accountId: 'chk-1' } as Transaction,
      { id: 't2', date: '2026-04-02', description: 'Rent', amount: -800, type: 'expense', category: 'Housing', accountId: 'chk-1' } as Transaction,
      { id: 't3', date: '2026-04-03', description: 'Move to savings', amount: -300, type: 'expense', category: 'Transfer', accountId: 'chk-1', transferGroupId: 'g1', transferRole: 'principal_out' } as Transaction,
      { id: 't4', date: '2026-04-03', description: 'From checking', amount: 300, type: 'income', category: 'Transfer', accountId: 'sav-1', transferGroupId: 'g1', transferRole: 'principal_in' } as Transaction,
    ];

    const report = buildFinancialIntegrityReport(accounts, txs);
    expect(report.isAccurate).toBe(true);
    expect(report.issues.length).toBe(0);
    expect(report.transferGroups[0].outAmount).toBe(300);
    expect(report.transferGroups[0].inAmount).toBe(300);
  });

  it('flags invalid numbers, unknown account links, and broken transfer groups', () => {
    const accounts: Account[] = [
      { id: 'c1', name: 'Card', type: 'Credit', balance: Number.NaN } as Account,
      { id: 'a1', name: 'Checking', type: 'Checking', balance: 100 } as Account,
    ];
    const txs: Transaction[] = [
      { id: 'x1', date: '2026-04-01', description: 'bad amount', amount: 0, type: 'expense', category: 'Food', accountId: 'a1' } as Transaction,
      { id: 'x2', date: '2026-04-01', description: 'orphan', amount: -10, type: 'expense', category: 'Food', accountId: 'missing' } as Transaction,
      { id: 'x3', date: '2026-04-01', description: 'transfer out', amount: -50, type: 'expense', category: 'Transfer', accountId: 'a1', transferGroupId: 'g2', transferRole: 'principal_out' } as Transaction,
    ];

    const report = buildFinancialIntegrityReport(accounts, txs);
    const codes = new Set(report.issues.map((i) => i.code));
    expect(report.isAccurate).toBe(false);
    expect(codes.has('INVALID_ACCOUNT_BALANCE')).toBe(true);
    expect(codes.has('INVALID_TRANSACTION_AMOUNT')).toBe(true);
    expect(codes.has('ACCOUNT_LINK_NOT_FOUND')).toBe(true);
    expect(codes.has('TRANSFER_GROUP_MISSING_LEG')).toBe(true);
  });

  it('flags transfer principal amount mismatch', () => {
    const accounts: Account[] = [
      { id: 'a1', name: 'Checking', type: 'Checking', balance: -40 } as Account,
      { id: 'a2', name: 'Savings', type: 'Savings', balance: 30 } as Account,
    ];
    const txs: Transaction[] = [
      { id: 'o', date: '2026-04-01', description: 'out', amount: -50, type: 'expense', category: 'Transfer', accountId: 'a1', transferGroupId: 'g3', transferRole: 'principal_out' } as Transaction,
      { id: 'i', date: '2026-04-01', description: 'in', amount: 40, type: 'income', category: 'Transfer', accountId: 'a2', transferGroupId: 'g3', transferRole: 'principal_in' } as Transaction,
      { id: 'f', date: '2026-04-01', description: 'fee', amount: -10, type: 'expense', category: 'Fee', accountId: 'a1', transferGroupId: 'g3', transferRole: 'fee' } as Transaction,
    ];

    const report = buildFinancialIntegrityReport(accounts, txs);
    expect(report.issues.some((i) => i.code === 'TRANSFER_GROUP_AMOUNT_MISMATCH')).toBe(true);
  });

  it('does not flag FX-equivalent transfer principal mismatch after SAR normalization', () => {
    const accounts: Account[] = [
      { id: 'usd-1', name: 'USD Checking', type: 'Checking', balance: 0, currency: 'USD' } as Account,
      { id: 'sar-1', name: 'SAR Checking', type: 'Checking', balance: 0, currency: 'SAR' } as Account,
    ];
    const txs: Transaction[] = [
      { id: 'fx-o', date: '2026-04-01', description: 'out usd', amount: -100, type: 'expense', category: 'Transfer', accountId: 'usd-1', transferGroupId: 'fx-1', transferRole: 'principal_out' } as Transaction,
      { id: 'fx-i', date: '2026-04-01', description: 'in sar', amount: 375, type: 'income', category: 'Transfer', accountId: 'sar-1', transferGroupId: 'fx-1', transferRole: 'principal_in' } as Transaction,
    ];
    const report = buildFinancialIntegrityReport(accounts, txs, { sarPerUsd: 3.75 });
    expect(report.issues.some((i) => i.code === 'TRANSFER_GROUP_AMOUNT_MISMATCH')).toBe(false);
  });
});
