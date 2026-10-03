import { describe, expect, it } from 'vitest';
import {
  applySmsCcPaymentTransfers,
  isSmsCcPaymentTx,
  parseSmsCcFundedFromNote,
  resolveCcPaymentFundingAccount,
  shouldImportSmsCcPaymentAsTransfer,
  smsNoteWithCcPaymentMeta,
} from '../services/smsCcPaymentTransfer';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import { parseSMSTransactions } from '../services/statementParser';
import { planStatementImport } from '../services/statementImportPrepare';
import type { Account, Transaction } from '../types';

describe('smsCcPaymentTransfer', () => {
  const visa: Account = {
    id: 'a7365',
    name: 'Visa 7365',
    type: 'Credit',
    balance: -2000,
    lastFourDigits: '7365',
  };
  const checking: Account = {
    id: 'a3138',
    name: 'Main Checking',
    type: 'Checking',
    balance: 10000,
    lastFourDigits: '3138',
    accountRole: 'debt_servicing',
  };
  const cashWallet: Account = {
    id: 'cash-1',
    name: 'Cash',
    type: 'Checking',
    balance: 200,
    accountRole: 'physical_cash',
  };

  it('resolves debt_servicing funding account and excludes physical cash', () => {
    const resolved = resolveCcPaymentFundingAccount([visa, checking, cashWallet], {
      excludeAccountIds: [visa.id],
    });
    expect(resolved.account?.id).toBe('a3138');
    expect(resolved.reason).toBe('role');
  });

  it('attaches sms:funded_from for سداد rows after routing', () => {
    const txs: Transaction[] = [
      {
        id: 'sadad1',
        date: '2026-09-25',
        description: 'بطاقة فيزا:سداد',
        amount: 1000,
        category: 'Transfer',
        accountId: 'a7365',
        type: 'income',
        note: 'sms:card=7365 sms:time=21:25 sms:kind=cc_payment',
      },
    ];
    const res = applySmsCcPaymentTransfers(txs, [visa, checking, cashWallet]);
    expect(res.expandedCount).toBe(1);
    expect(res.unresolvedCount).toBe(0);
    const tx = res.transactions[0];
    expect(tx.accountId).toBe('a7365');
    expect(parseSmsCcFundedFromNote(tx.note)).toBe('a3138');
    expect(tx.category).toBe('Transfer');
    expect(tx.budgetCategory).toBeUndefined();
    expect(shouldImportSmsCcPaymentAsTransfer(tx)).toBe(true);
    expect(isSmsCcPaymentTx(tx)).toBe(true);
  });

  it('warns when no eligible funding account exists', () => {
    const txs: Transaction[] = [
      {
        id: 'sadad1',
        date: '2026-09-25',
        description: 'بطاقة فيزا:سداد',
        amount: 500,
        category: 'Transfer',
        accountId: 'a7365',
        type: 'income',
        note: 'sms:kind=cc_payment sms:card=7365',
      },
    ];
    const res = applySmsCcPaymentTransfers(txs, [visa, cashWallet]);
    expect(res.expandedCount).toBe(0);
    expect(res.unresolvedCount).toBe(1);
    expect(res.warnings.some((w) => /funding account/i.test(w))).toBe(true);
    expect(parseSmsCcFundedFromNote(res.transactions[0].note)).toBeNull();
  });

  it('preserves card/time meta when stamping funded_from', () => {
    const note = smsNoteWithCcPaymentMeta('sms:card=7365 sms:time=21:25', {
      fundedFromAccountId: 'a3138',
    });
    expect(note).toContain('sms:card=7365');
    expect(note).toContain('sms:time=21:25');
    expect(note).toContain('sms:kind=cc_payment');
    expect(note).toContain('sms:funded_from=a3138');
  });

  it('never assigns a budget category to سداد / ATM transfer rows', () => {
    const sadad = categorizeImportedTransaction(
      {
        type: 'income',
        description: 'CC payment ← Main Checking · Visa 7365',
        amount: 1000,
        category: 'Transfer',
        note: 'sms:kind=cc_payment sms:funded_from=a3138 sms:card=7365',
      },
      {
        budgetCategoryNames: ['Food & Dining', 'Shopping'],
        userHistory: [
          {
            id: 'h',
            type: 'income',
            description: 'CC payment ← Main Checking · Visa 7365',
            amount: 1000,
            category: 'Income',
            budgetCategory: 'Food & Dining',
            accountId: 'a7365',
            date: '2026-01-01',
            status: 'Approved',
          },
        ],
      },
    );
    expect(sadad.category).toBe('Transfer');
    expect(sadad.budgetCategory).toBeUndefined();

    const atm = categorizeImportedTransaction(
      {
        type: 'expense',
        description: 'ATM → Cash · ALFALAH',
        amount: -450,
        category: 'Shopping',
        note: 'sms:kind=atm sms:cash_to=cash-1',
      },
      { budgetCategoryNames: ['Food & Dining', 'Shopping'] },
    );
    expect(atm.category).toBe('Transfer');
    expect(atm.budgetCategory).toBeUndefined();
  });

  it('planStatementImport rejects سداد without funding and ATM without cash', () => {
    const accounts = [visa, checking, cashWallet];
    const rows: Transaction[] = [
      {
        id: 's1',
        date: '2026-09-25',
        description: 'CC payment',
        amount: 1000,
        category: 'Transfer',
        accountId: 'a7365',
        type: 'income',
        note: 'sms:kind=cc_payment sms:card=7365',
      },
      {
        id: 'a1',
        date: '2026-09-13',
        description: 'ATM',
        amount: -450,
        category: 'Transfer',
        accountId: 'a3138',
        type: 'expense',
        note: 'sms:kind=atm',
      },
    ];
    const plan = planStatementImport({
      bankTransactions: rows,
      investmentTransactions: [],
      selectedIndices: new Set([0, 1]),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios: [],
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
      },
    });
    expect(plan.importableBankRows.length).toBe(0);
    expect(plan.skippedValidation).toBe(2);
    expect(plan.validationMessages.some((m) => /Paid-from|funding/i.test(m))).toBe(true);
    expect(plan.validationMessages.some((m) => /Cash destination/i.test(m))).toBe(true);
  });

  it('planStatementImport accepts ready ATM + سداد transfer rows and clears budget', () => {
    const accounts = [visa, checking, cashWallet];
    const rows: Transaction[] = [
      {
        id: 's1',
        date: '2026-09-25',
        description: 'CC payment',
        amount: 1000,
        category: 'Shopping',
        budgetCategory: 'Shopping',
        accountId: 'a7365',
        type: 'income',
        note: 'sms:kind=cc_payment sms:card=7365 sms:funded_from=a3138',
      },
      {
        id: 'a1',
        date: '2026-09-13',
        description: 'ATM',
        amount: -450,
        category: 'Shopping',
        budgetCategory: 'Shopping',
        accountId: 'a3138',
        type: 'expense',
        note: 'sms:kind=atm sms:cash_to=cash-1',
      },
    ];
    const plan = planStatementImport({
      bankTransactions: rows,
      investmentTransactions: [],
      selectedIndices: new Set([0, 1]),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios: [],
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
      },
    });
    expect(plan.importableBankRows.length).toBe(2);
    expect(plan.skippedValidation).toBe(0);
    for (const row of plan.importableBankRows) {
      expect(row.tx.category).toBe('Transfer');
      expect(row.tx.budgetCategory).toBeUndefined();
    }
  });
});

describe('parseSMSTransactions سداد → funding transfer', () => {
  it('routes سداد SMS to card and stamps funding source end-to-end', async () => {
    const accounts: Account[] = [
      { id: 'a7365', name: 'Visa 7365', type: 'Credit', balance: -1000, lastFourDigits: '7365' },
      {
        id: 'a3138',
        name: 'Main Checking',
        type: 'Checking',
        balance: 8000,
        lastFourDigits: '3138',
        accountRole: 'debt_servicing',
      },
      { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
    ];
    const sms = `بطاقة فيزا:سداد بـSR 1000
عبر7365;فيزا
رصيد:1035.48 SR
25/9/26 21:25
بطاقة فيزا:سداد بـSR 669.99
عبر7365;فيزا
رصيد:1705.47 SR
26/9/26 10:00`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions.length).toBe(2);
    for (const tx of res.transactions) {
      expect(tx.accountId).toBe('a7365');
      expect(tx.amount).toBeGreaterThan(0);
      expect(tx.category).toBe('Transfer');
      expect(tx.type).toBe('income');
      expect(tx.budgetCategory).toBeUndefined();
      expect(parseSmsCcFundedFromNote(tx.note)).toBe('a3138');
      expect(tx.note).toContain('sms:kind=cc_payment');
      expect(shouldImportSmsCcPaymentAsTransfer(tx)).toBe(true);
    }
  });
});
