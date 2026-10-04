import { describe, expect, it } from 'vitest';
import {
  applySmsAtmCashTransfers,
  isSmsAtmWithdrawalTx,
  parseSmsAtmCashToFromNote,
  resolvePhysicalCashAccount,
  shouldImportSmsAtmAsTransfer,
  smsNoteWithAtmMeta,
} from '../services/smsAtmCashTransfer';
import { parseSMSTransactions } from '../services/statementParser';
import type { Account, Transaction } from '../types';

describe('smsAtmCashTransfer', () => {
  const mada: Account = {
    id: 'a8529',
    name: 'Mada 8529',
    type: 'Checking',
    balance: 5000,
    lastFourDigits: '8529',
  };
  const cashWallet: Account = {
    id: 'cash-1',
    name: 'Cash',
    type: 'Checking',
    balance: 200,
    accountRole: 'physical_cash',
  };

  it('resolves physical_cash role over name heuristics', () => {
    const named: Account = { id: 'n1', name: 'Cash on Hand', type: 'Checking', balance: 0 };
    const role: Account = {
      id: 'r1',
      name: 'Wallet',
      type: 'Savings',
      balance: 0,
      accountRole: 'physical_cash',
    };
    const resolved = resolvePhysicalCashAccount([mada, named, role], { excludeAccountIds: [mada.id] });
    expect(resolved.account?.id).toBe('r1');
    expect(resolved.reason).toBe('role');
  });

  it('resolves Cash/نقد name when no role is set', () => {
    const ar: Account = { id: 'ar1', name: 'نقد', type: 'Checking', balance: 50 };
    const resolved = resolvePhysicalCashAccount([mada, ar], { excludeAccountIds: [mada.id] });
    expect(resolved.account?.id).toBe('ar1');
    expect(resolved.reason).toBe('name');
  });

  it('attaches sms:cash_to for ATM rows after routing', () => {
    const txs: Transaction[] = [
      {
        id: 'atm1',
        date: '2026-09-13',
        description: 'CA-ALFALAH BR.',
        amount: -450,
        category: 'Transfer',
        accountId: 'a8529',
        type: 'expense',
        note: 'sms:card=8529 sms:time=22:03 sms:kind=atm',
      },
    ];
    const res = applySmsAtmCashTransfers(txs, [mada, cashWallet]);
    expect(res.expandedCount).toBe(1);
    expect(res.unresolvedCount).toBe(0);
    const tx = res.transactions[0];
    expect(tx.accountId).toBe('a8529');
    expect(parseSmsAtmCashToFromNote(tx.note)).toBe('cash-1');
    expect(tx.category).toBe('Transfer');
    expect(tx.description).toContain('ATM → Cash');
    expect(tx.description).toContain('ALFALAH');
    expect(shouldImportSmsAtmAsTransfer(tx)).toBe(true);
  });

  it('warns when no cash account exists', () => {
    const txs: Transaction[] = [
      {
        id: 'atm1',
        date: '2026-09-13',
        description: 'TAMIM STATION',
        amount: -1000,
        category: 'Transfer',
        accountId: 'a8529',
        type: 'expense',
        note: 'sms:kind=atm sms:card=8529',
      },
    ];
    const res = applySmsAtmCashTransfers(txs, [mada]);
    expect(res.expandedCount).toBe(0);
    expect(res.unresolvedCount).toBe(1);
    expect(res.warnings.some((w) => /Cash account/i.test(w))).toBe(true);
    expect(parseSmsAtmCashToFromNote(res.transactions[0].note)).toBeNull();
    expect(isSmsAtmWithdrawalTx(res.transactions[0])).toBe(true);
  });

  it('preserves card/time meta when stamping cash_to', () => {
    const note = smsNoteWithAtmMeta('sms:card=8529 sms:time=21:37', {
      kind: 'atm',
      cashToAccountId: 'cash-1',
    });
    expect(note).toContain('sms:card=8529');
    expect(note).toContain('sms:time=21:37');
    expect(note).toContain('sms:kind=atm');
    expect(note).toContain('sms:cash_to=cash-1');
  });
});

describe('parseSMSTransactions ATM → cash', () => {
  it('routes ATM SMS to source card and stamps cash destination end-to-end', async () => {
    const accounts: Account[] = [
      { id: 'a8529', name: 'Mada 8529', type: 'Checking', balance: 8000, lastFourDigits: '8529' },
      { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
    ];
    const sms = `سحب:صراف آلي بSR 450
عبر8529;مدى
منCA-ALFALAH BR. 2
13/9/26 22:03
سحب:صراف آلي بSR 1000
عبر8529;مدى
منTAMIM STATION
13/9/26 22:51`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions.length).toBe(2);
    for (const tx of res.transactions) {
      expect(tx.accountId).toBe('a8529');
      expect(tx.amount).toBeLessThan(0);
      expect(tx.category).toBe('Transfer');
      expect(parseSmsAtmCashToFromNote(tx.note)).toBe('cash-1');
      expect(tx.note).toContain('sms:kind=atm');
      expect(shouldImportSmsAtmAsTransfer(tx)).toBe(true);
    }
    expect(res.transactions.some((t) => Math.abs(t.amount + 450) < 0.01)).toBe(true);
    expect(res.transactions.some((t) => Math.abs(t.amount + 1000) < 0.01)).toBe(true);
    expect(res.transactions.find((t) => Math.abs(t.amount + 450) < 0.01)?.description).toMatch(/ALFALAH/i);
  });
});
