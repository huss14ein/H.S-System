import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';
import { extractSmsCardLast4 } from '../services/smsImportRouting';
import {
  extractSmsTransferDestinationLast4,
  smsTextLooksLikeAccountTransferIn,
  smsTextLooksLikeAccountTransferOut,
} from '../services/smsBankTransferPatterns';
import {
  parseSmsAccountTransferFromFromNote,
  parseSmsAccountTransferToFromNote,
  shouldImportSmsAccountAsTransfer,
  shouldImportSmsAccountTransferInAsTransfer,
} from '../services/smsAccountTransfer';
import { planStatementImport } from '../services/statementImportPrepare';
import type { Account } from '../types';

beforeEach(() => {
  vi.mocked(invokeAI).mockReset();
  vi.mocked(invokeAI).mockResolvedValue({ text: '[]' } as any);
});

const accounts: Account[] = [
  { id: 'cc-3282', name: 'Visa 3282', type: 'Credit', balance: -2000, lastFourDigits: '3282' },
  { id: 'mada-4136', name: 'Mada 4136', type: 'Checking', balance: 5000, lastFourDigits: '4136' },
  { id: 'chk-0001', name: 'Alinma 0001', type: 'Checking', balance: 10000, lastFourDigits: '0001' },
  { id: 'chk-7000', name: 'Savings 7000', type: 'Savings', balance: 3000, lastFourDigits: '7000' },
  {
    id: 'chk-3138',
    name: 'Main Checking',
    type: 'Checking',
    balance: 20000,
    lastFourDigits: '3138',
    accountRole: 'operating_cash',
  },
  { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
];

describe('Alinma-style SMS (description, account, amounts)', () => {
  it('extracts card last-4 preferring بطاقة / مدى over حساب / لحساب', () => {
    expect(
      extractSmsCardLast4(`شراء دولي إنترنت SAR 49
بطاقة ائتمانية **3282
حساب **0001
من NL- NETFLIX.COM`),
    ).toBe('3282');
    expect(extractSmsCardLast4('شراء POS-مدى 4136*-أثير\nبـ 40 SAR\nمن Mtam Ur Na*')).toBe('4136');
    expect(
      extractSmsCardLast4(`حوالة صادرة داخلية
مبلغ 500.00 ريال
لـ فاطمه فهمي محمد السقاف
لحساب *7000`),
    ).toBeNull();
    expect(extractSmsTransferDestinationLast4('لحساب *7000')).toBe('7000');
    expect(extractSmsCardLast4('من3138\nلـ0102;abdullah')).toBe('3138');
  });

  it('detects صادرة/واردة word-order variants', () => {
    expect(smsTextLooksLikeAccountTransferOut('حوالة صادرة داخلية')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('حوالة محلية صادرة')).toBe(true);
    expect(smsTextLooksLikeAccountTransferIn('حوالة واردة محلية')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('حوالة واردة محلية')).toBe(false);
  });

  it('parses outgoing لحساب *7000 without debiting the destination', async () => {
    const sms = `حوالة صادرة داخلية
مبلغ 500.00 ريال
لـ فاطمه فهمي محمد السقاف
لحساب *7000
في 26-08-29 21:31`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    const tx = res.transactions[0];
    expect(tx.amount).toBeCloseTo(-500, 2);
    expect(tx.category).toBe('Transfer');
    expect(tx.accountId).not.toBe('chk-7000');
    expect(tx.description).toMatch(/فاطمه/);
    expect(tx.note).toContain('sms:to_card=7000');
    expect(tx.note).toContain('sms:transfer_to=chk-7000');
    expect(tx.note).not.toMatch(/sms:card=7000/);
    // Needs a source account before addTransfer.
    expect(shouldImportSmsAccountAsTransfer(tx)).toBe(false);
    const ready = {
      ...tx,
      accountId: 'chk-0001',
      note: `${tx.note} `.replace(/\s+$/, ''),
    };
    // With source assigned, transfer_to remains.
    expect(parseSmsAccountTransferToFromNote(ready.note)).toBe('chk-7000');
  });

  it('parses incoming حوالة واردة as linked transfer needing Received-from', async () => {
    const sms = `حوالة واردة محلية
مبلغ 2,500 SAR
من HUSSAIN MURTADHA ALI ALSAGGAF
حساب *0001
في 21:30 26-08-30`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    const tx = res.transactions[0];
    expect(tx.amount).toBeCloseTo(2500, 2);
    expect(tx.type).toBe('income');
    expect(tx.category).toBe('Transfer');
    expect(tx.accountId).toBe('chk-0001');
    expect(tx.description.toUpperCase()).toContain('HUSSAIN');
    expect(tx.note).toContain('sms:kind=account_transfer_in');
    expect(parseSmsAccountTransferFromFromNote(tx.note)).toBeNull();
    expect(shouldImportSmsAccountTransferInAsTransfer(tx)).toBe(false);

    expect(shouldImportSmsAccountTransferInAsTransfer({
      ...tx,
      note: `sms:card=0001 sms:kind=account_transfer_in sms:transfer_from=chk-3138`,
    })).toBe(true);

    const plan = planStatementImport({
      bankTransactions: [tx],
      investmentTransactions: [],
      selectedIndices: new Set([0]),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios: [],
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
      },
    });
    expect(plan.skippedValidation).toBe(1);
    expect(plan.validationMessages[0]).toMatch(/Received-from/i);
  });

  it('pairs outgoing + incoming حوالة from the same paste into one transfer', async () => {
    const sms = `حوالة محلية صادرة بـSR 2500
من3138
لـ0001;حسين السقاف
رسوم:SR 0.58
26/8/30 21:30
حوالة واردة محلية
مبلغ 2,500 SAR
من HUSSAIN MURTADHA ALI ALSAGGAF
حساب *0001
في 21:30 26-08-30`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions.length).toBeGreaterThanOrEqual(2);
    const out = res.transactions.find((t) => Number(t.amount) < 0)!;
    const inn = res.transactions.find((t) => Number(t.amount) > 0)!;
    expect(out.note).toContain('sms:kind=account_transfer');
    expect(parseSmsAccountTransferToFromNote(out.note)).toBe('chk-0001');
    expect(inn.note).toContain('sms:kind=account_transfer_in');
    expect(parseSmsAccountTransferFromFromNote(inn.note)).toBe('chk-3138');
    expect(inn.note).toContain('sms:paired=1');
    expect(shouldImportSmsAccountAsTransfer(out)).toBe(true);

    const plan = planStatementImport({
      bankTransactions: res.transactions,
      investmentTransactions: [],
      selectedIndices: new Set(res.transactions.map((_, i) => i)),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios: [],
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
      },
    });
    // Outbound imports; paired inbound is skipped (not double-counted).
    expect(plan.skippedValidation).toBe(0);
    expect(plan.importableBankRows.some((r) => r.tx.amount < 0)).toBe(true);
    expect(plan.importableBankRows.every((r) => !(Number(r.tx.amount) > 0 && isInbound(r.tx)))).toBe(
      true,
    );
  });
});

function isInbound(tx: { note?: string; amount: number }): boolean {
  return Number(tx.amount) > 0 && /sms:kind=account_transfer_in\b/i.test(String(tx.note || ''));
}

describe('Alinma-style SMS (purchases)', () => {
  it('keeps Netflix FX fee+due on the card (المبلغ المستحق) with merchant name', async () => {
    const sms = `شراء دولي إنترنت SAR 49 
بطاقة ائتمانية **3282
حساب **0001
من NL- NETFLIX.COM
في 13:51:17 2026-09-04
رسوم SAR 1.13 
سعر صرف 1.00
المبلغ المستحق SAR 50.13
رصيد SAR 127.81`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    const tx = res.transactions[0];
    expect(tx.amount).toBeCloseTo(-50.13, 2);
    expect(tx.accountId).toBe('cc-3282');
    expect(tx.description.toUpperCase()).toContain('NETFLIX');
    expect(tx.category).toBe('Shopping');
  });

  it('parses POS/Internet ApplePay merchants without SA/ country prefix', async () => {
    const sms = `شراء POS-ApplePay
بـ SAR 144.25
بطاقة ائتمانية *3282
لدى SA /Tamara
في 26-09-10 10:04
الرصيد 1,805.62
شراء إنترنت ApplePay
بـ 14 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 08:53 26-09-14
رصيد 1,791.62`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(2);
    const tamara = res.transactions.find((t) => Math.abs(t.amount + 144.25) < 0.01)!;
    const bolt = res.transactions.find((t) => Math.abs(t.amount + 14) < 0.01)!;
    expect(tamara.accountId).toBe('cc-3282');
    expect(tamara.description).toMatch(/Tamara/i);
    expect(tamara.description).not.toMatch(/^SA\b/);
    expect(bolt.description).toMatch(/bolt\.eu/i);
  });

  it('routes مدى 4136* POS to the Mada account', async () => {
    const sms = `شراء POS-مدى 4136*-أثير
بـ 40 SAR
من Mtam Ur Na*
26-09-24 20:55`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].accountId).toBe('mada-4136');
    expect(res.transactions[0].amount).toBeCloseTo(-40, 2);
    expect(res.transactions[0].description).toMatch(/Mtam/i);
  });

  it('does not regress Al Rajhi حوالة محلية صادرة من/لـ routing', async () => {
    const sms = `حوالة محلية صادرة بـSR 2500
من3138
لـ0001;حسين السقاف
رسوم:SR 0.58
26/9/30 22:14`;
    const res = await parseSMSTransactions(sms, '', { accounts });
    expect(res.transactions).toHaveLength(1);
    const tx = res.transactions[0];
    expect(tx.accountId).toBe('chk-3138');
    expect(tx.amount).toBeCloseTo(-2500.58, 2);
    expect(parseSmsAccountTransferToFromNote(tx.note)).toBe('chk-0001');
    expect(shouldImportSmsAccountAsTransfer(tx)).toBe(true);
  });
});
