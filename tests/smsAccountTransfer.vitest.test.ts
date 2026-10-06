import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';
import {
  smsTextLooksLikeAccountTransferOut,
  extractSmsTransferDestinationLast4,
  extractSmsTransferFeeAmount,
} from '../services/smsBankTransferPatterns';
import {
  isSmsAccountTransferInTx,
  isSmsAccountTransferTx,
  shouldImportSmsAccountAsTransfer,
  shouldImportSmsAccountTransferInAsTransfer,
  parseSmsAccountTransferToFromNote,
  parseSmsAccountTransferFromFromNote,
  parseSmsTransferFeeFromNote,
  smsAccountTransferPrincipalAmount,
  applySmsAccountTransfers,
  applySmsAccountTransferIns,
  pairSmsAccountTransferLegs,
} from '../services/smsAccountTransfer';
import { isSmsLedgerTransferTx, shouldSkipBudgetForImportedTx } from '../services/smsImportTransferGuards';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import type { Account } from '../types';

beforeEach(() => {
  vi.mocked(invokeAI).mockReset();
  vi.mocked(invokeAI).mockResolvedValue({ text: '[]' } as any);
});

const accounts: Account[] = [
  {
    id: 'chk-3138',
    name: 'Main Checking',
    type: 'Checking',
    balance: 50000,
    lastFourDigits: '3138',
    accountRole: 'operating_cash',
  },
  {
    id: 'sav-0001',
    name: 'Savings 0001',
    type: 'Savings',
    balance: 10000,
    lastFourDigits: '0001',
  },
  {
    id: 'chk-1527',
    name: 'Other Checking',
    type: 'Checking',
    balance: 2000,
    lastFourDigits: '1527',
  },
  { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
];

describe('smsBankTransferPatterns — حوالة', () => {
  it('detects Arabic and English outgoing local/internal transfers', () => {
    expect(smsTextLooksLikeAccountTransferOut('حوالة محلية صادرة بـSR 2500')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('حوالة داخلية صادرة بـSR 5500')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('Outgoing local transfer SAR 100')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('Internal transfer out SAR 50')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('شراء عبر نقاط البيع لدى CAFE')).toBe(false);
    expect(smsTextLooksLikeAccountTransferOut('بطاقة فيزا:سداد بـSR 1000')).toBe(false);
  });

  it('extracts destination last-4 and fee from Al Rajhi-style SMS', () => {
    const sms = `حوالة محلية صادرة بـSR 2500
من3138
لـ0001;حسين السقاف
رسوم:SR 0.58
26/9/30 22:14`;
    expect(extractSmsTransferDestinationLast4(sms)).toBe('0001');
    expect(extractSmsTransferFeeAmount(sms)).toBeCloseTo(0.58, 2);
  });
});

describe('parseSMSTransactions — حوالة as account transfer', () => {
  it('imports حوالة محلية صادرة to a matching account as addTransfer-ready (with fee)', async () => {
    const sms = `حوالة محلية صادرة بـSR 2500
من3138
لـ0001;حسين السقاف
رسوم:SR 0.58
26/9/30 22:14`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions.length).toBe(1);
    const tx = res.transactions[0];
    expect(tx.amount).toBeCloseTo(-2500.58, 2);
    expect(tx.date).toBe('2026-09-30');
    expect(tx.accountId).toBe('chk-3138');
    expect(tx.category).toBe('Transfer');
    expect(tx.note).toContain('sms:kind=account_transfer');
    expect(tx.note).toContain('sms:to_card=0001');
    expect(tx.note).toContain('sms:fee=0.58');
    expect(parseSmsAccountTransferToFromNote(tx.note)).toBe('sav-0001');
    expect(parseSmsTransferFeeFromNote(tx.note)).toBeCloseTo(0.58, 2);
    expect(smsAccountTransferPrincipalAmount(tx)).toBeCloseTo(2500, 2);
    expect(isSmsAccountTransferTx(tx)).toBe(true);
    expect(shouldImportSmsAccountAsTransfer(tx)).toBe(true);
    expect(isSmsLedgerTransferTx(tx)).toBe(true);
    expect(shouldSkipBudgetForImportedTx(tx)).toBe(true);

    const mapped = categorizeImportedTransaction(tx, {
      budgetCategoryNames: ['Food & Dining', 'Shopping', 'Transfers'],
    });
    expect(mapped.category).toBe('Transfer');
    expect(mapped.budgetCategory).toBeUndefined();
  });

  it('keeps حوالة to unknown last-4 as external expense (budgetable)', async () => {
    const sms = `حوالة محلية صادرة بـSR 300
من3138
لـ0102;abdullah alsaggaf
رسوم:SR 0.58
26/9/9 20:47`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    const tx = res.transactions[0];
    expect(tx).toBeDefined();
    expect(tx.note).toContain('sms:kind=account_transfer');
    expect(tx.note).toContain('sms:xfer_scope=external');
    expect(tx.note).toContain('sms:to_card=0102');
    expect(parseSmsAccountTransferToFromNote(tx.note)).toBeNull();
    expect(shouldImportSmsAccountAsTransfer(tx)).toBe(false);
    expect(isSmsLedgerTransferTx(tx)).toBe(false);
    expect(shouldSkipBudgetForImportedTx(tx)).toBe(false);
    expect(tx.type).toBe('expense');
    expect(tx.category).not.toBe('Transfer');
  });

  it('resolves حوالة داخلية when destination last-4 is configured', async () => {
    const sms = `حوالة داخلية صادرة بـSR 5500
من3138
لـ1527;محمد ابوصوله
26/9/6 23:14`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    const tx = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 5500) < 0.01);
    expect(tx).toBeDefined();
    expect(shouldImportSmsAccountAsTransfer(tx!)).toBe(true);
    expect(parseSmsAccountTransferToFromNote(tx!.note)).toBe('chk-1527');
  });
});

describe('applySmsAccountTransfers', () => {
  it('attaches transfer_to when destination last-4 uniquely matches', () => {
    const result = applySmsAccountTransfers(
      [
        {
          id: 't1',
          date: '2026-09-30',
          description: 'حسين السقاف',
          amount: -2500.58,
          category: 'Transfer',
          accountId: 'chk-3138',
          type: 'expense',
          status: 'Approved',
          note: 'sms:card=3138 sms:time=22:14 sms:kind=account_transfer sms:to_card=0001 sms:fee=0.58',
        },
      ],
      accounts,
    );
    expect(result.expandedCount).toBe(1);
    expect(parseSmsAccountTransferToFromNote(result.transactions[0].note)).toBe('sav-0001');
    expect(result.transactions[0].description).toMatch(/Transfer → Savings 0001/);
  });
});

describe('حوالة واردة inbound transfer', () => {
  it('marks unpaired incoming SMS as external income by default', async () => {
    const sms = `حوالة واردة محلية
مبلغ 1,000 SAR
من AHMED ALI
حساب *0001
في 10:00 26-09-15`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    const tx = res.transactions[0];
    expect(isSmsAccountTransferInTx(tx)).toBe(true);
    expect(isSmsAccountTransferTx(tx)).toBe(false);
    expect(tx.note).toContain('sms:kind=account_transfer_in');
    expect(tx.note).toContain('sms:xfer_scope=external');
    expect(shouldImportSmsAccountTransferInAsTransfer(tx)).toBe(false);
    expect(isSmsLedgerTransferTx(tx)).toBe(false);
    expect(shouldSkipBudgetForImportedTx(tx)).toBe(false);
    expect(tx.category).toBe('Income');
  });

  it('pairs same-paste outgoing + incoming into one addTransfer-ready leg', () => {
    const marked = applySmsAccountTransferIns(
      applySmsAccountTransfers(
        [
          {
            id: 'out',
            date: '2026-09-15',
            description: 'Transfer · Fatima',
            amount: -1000,
            category: 'Transfer',
            accountId: 'chk-3138',
            type: 'expense',
            status: 'Approved',
            note: 'sms:kind=account_transfer sms:to_card=0001',
          },
          {
            id: 'inn',
            date: '2026-09-15',
            description: 'AHMED ALI',
            amount: 1000,
            category: 'Transfer',
            accountId: 'sav-0001',
            type: 'income',
            status: 'Approved',
            note: 'sms:kind=account_transfer_in sms:card=0001',
          },
        ],
        accounts,
      ).transactions,
      accounts,
    );
    const paired = pairSmsAccountTransferLegs(marked.transactions, accounts);
    expect(paired.pairedCount).toBe(1);
    const inn = paired.transactions.find((t) => t.id === 'inn')!;
    const out = paired.transactions.find((t) => t.id === 'out')!;
    expect(parseSmsAccountTransferFromFromNote(inn.note)).toBe('chk-3138');
    expect(inn.note).toContain('sms:paired=1');
    expect(parseSmsAccountTransferToFromNote(out.note)).toBe('sav-0001');
    expect(shouldImportSmsAccountAsTransfer(out)).toBe(true);
  });
});