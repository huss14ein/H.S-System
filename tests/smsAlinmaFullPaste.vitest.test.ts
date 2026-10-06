import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';
import { shouldImportSmsAccountAsTransfer } from '../services/smsAccountTransfer';
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
  { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
];

/** Full production paste from user report (Alinma-style). */
export const ALINMA_FULL_USER_PASTE = `حوالة صادرة داخلية
مبلغ 500.00 ريال
لـ فاطمه فهمي محمد السقاف
لحساب *7000
في 26-08-29 21:31
حوالة واردة محلية
مبلغ 2,500 SAR
من HUSSAIN MURTADHA ALI ALSAGGAF
حساب *0001
في 21:30 26-08-30
شراء دولي إنترنت SAR 49 
بطاقة ائتمانية **3282
حساب **0001
من NL- NETFLIX.COM
في 13:51:17 2026-09-04
رسوم SAR 1.13 
سعر صرف 1.00
المبلغ المستحق SAR 50.13
رصيد SAR 127.81
شراء POS-ApplePay
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
رصيد 1,791.62
شراء POS-ApplePay
بـ SAR 115.58
بطاقة ائتمانية *3282
لدى SA /Tamara
في 26-09-14 09:46
الرصيد 1,676.04
شراء POS-ApplePay
بـ SAR 25.00
بطاقة ائتمانية *3282
لدى SA /bolt.eu
في 26-09-14 11:50
الرصيد 1,651.04
شراء إنترنت ApplePay
بـ 225 SAR
بطاقة ائتمانية *3282
لدى SA/MYSR*Blu
في 20:28 26-09-15
رصيد 1,440.04
شراء إنترنت ApplePay
بـ 39 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 20:31 26-09-15
رصيد 1,401.04
شراء POS-ApplePay
بـ SAR 259.99
بطاقة ائتمانية *3282
لدى SA /FOR ALHILA*
في 26-09-15 23:25
الرصيد 1,141.05
شراء إنترنت ApplePay
بـ 59 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 23:34 26-09-15
رصيد 1,082.05
شراء إنترنت ApplePay
بـ 14 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 11:27 26-09-16
رصيد 1,068.05
شراء إنترنت ApplePay
بـ 11 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 21:07 26-09-16
رصيد 1,057.05
شراء إنترنت ApplePay
بـ 19 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 11:52 26-09-17
رصيد 1,038.05
شراء إنترنت ApplePay
بـ 29 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 18:44 26-09-17
رصيد 1,009.05
شراء POS-ApplePay
بـ SAR 15.00
بطاقة ائتمانية *3282
لدى SA /MEED 1053 *
في 26-09-17 21:22
الرصيد 994.05
شراء POS-ApplePay
بـ SAR 4.00
بطاقة ائتمانية *3282
لدى SA /70069 riya*
في 26-09-17 21:32
الرصيد 990.05
شراء إنترنت ApplePay
بـ 59 SAR
بطاقة ائتمانية *3282
لدى SA/bolt.eu
في 00:14 26-09-18
رصيد 931.05
شراء إنترنت ApplePay
بـ 145.90 SAR
بطاقة ائتمانية *3282
لدى SA/HUNGERSTAT*
في 15:20 26-09-18
رصيد 785.15
شراء عبر: POS
البطاقة الائتمانية: **3282
مبلغ: SAR 30.50
لدى: ROKN MOSHRFA
في: 11:34 2026-09-19
الرصيد: 754.65 ريال
شراء إنترنت ApplePay
بـ 85 SAR
بطاقة ائتمانية *3282
لدى SA/yaqoot 02
في 11:54 26-09-21
رصيد 669.65
شراء POS-ApplePay
بـ SAR 120.02
بطاقة ائتمانية *3282
لدى SA /NAFT
في 26-09-21 23:37
الرصيد 549.63
شراء إنترنت ApplePay
بـ 400 SAR
بطاقة ائتمانية *3282
لدى SA/Luxury Car*
في 21:28 26-09-22
رصيد 149.63
شراء POS-مدى 4136*-أثير
بـ 40 SAR
من Mtam Ur Na*
26-09-24 20:55
شراء POS-ApplePay
بـ SAR 42.06
بطاقة ائتمانية *3282
لدى SA /ALDREES 69*
في 26-09-24 12:35
الرصيد 107.57
حوالة واردة محلية
مبلغ 2,500 SAR
من HUSSAIN MURTADHA ALI ALSAGGAF
حساب *0001
في 22:15 26-10-01
حوالة صادرة داخلية
مبلغ 1046.00 ريال
لـ فاطمه فهمي محمد السقاف
لحساب *7000
في 26-09-30 22:18
شراء دولي إنترنت SAR 49 
بطاقة ائتمانية **3282
حساب **0001
من FR- Netflix.com
في 04:30:27 2026-10-04
رسوم SAR 1.13 
سعر صرف 1.00
المبلغ المستحق SAR 50.13
رصيد SAR 57.44`;

describe('Alinma full user paste regression', () => {
  it('parses all 28 rows with correct accounts, amounts, and descriptions', async () => {
    const res = await parseSMSTransactions(ALINMA_FULL_USER_PASTE, '', { accounts });
    expect(res.transactions).toHaveLength(28);

    for (const tx of res.transactions) {
      expect(tx.description).not.toMatch(/^SMS Transaction/i);
      expect(tx.description).not.toMatch(/^SA\b/);
      // Purchases always have an account; outgoing حوالة may need source in review.
      if (!String(tx.note || '').includes('sms:kind=account_transfer')) {
        expect(String(tx.accountId || '').trim()).not.toBe('');
      }
    }

    const out500 = res.transactions.find((t) => Math.abs(t.amount + 500) < 0.01)!;
    expect(out500.accountId).not.toBe('chk-7000');
    expect(out500.note).toContain('sms:transfer_to=chk-7000');
    expect(out500.description).toMatch(/فاطمه/);
    expect(shouldImportSmsAccountAsTransfer(out500)).toBe(false);

    const in2500 = res.transactions.filter((t) => Math.abs(t.amount - 2500) < 0.01);
    expect(in2500).toHaveLength(2);
    for (const tx of in2500) {
      expect(tx.type).toBe('income');
      expect(tx.category).toBe('Transfer');
      expect(tx.accountId).toBe('chk-0001');
      expect(tx.description.toUpperCase()).toContain('HUSSAIN');
      expect(tx.note).toContain('sms:kind=account_transfer_in');
    }

    const netflix = res.transactions.filter((t) => Math.abs(t.amount + 50.13) < 0.01);
    expect(netflix).toHaveLength(2);
    for (const tx of netflix) {
      expect(tx.accountId).toBe('cc-3282');
      expect(tx.description.toUpperCase()).toContain('NETFLIX');
    }

    const mada = res.transactions.find((t) => Math.abs(t.amount + 40) < 0.01 && t.date === '2026-09-24')!;
    expect(mada.accountId).toBe('mada-4136');

    const luxury = res.transactions.find((t) => Math.abs(t.amount + 400) < 0.01)!;
    expect(luxury.description).toMatch(/Luxury Car/i);
    expect(luxury.accountId).toBe('cc-3282');

    // Assign source on outgoing حوالة + Received-from on واردة so import plan is ready.
    const prepared = res.transactions.map((t) => {
      if (
        /sms:kind=account_transfer\b/i.test(String(t.note || '')) &&
        !/sms:kind=account_transfer_in\b/i.test(String(t.note || '')) &&
        !t.accountId
      ) {
        return { ...t, accountId: 'chk-0001' };
      }
      if (
        /sms:kind=account_transfer_in\b/i.test(String(t.note || '')) &&
        !/sms:transfer_from=/i.test(String(t.note || ''))
      ) {
        return {
          ...t,
          note: `${t.note} sms:transfer_from=chk-7000`.trim(),
        };
      }
      return t;
    });
    const plan = planStatementImport({
      bankTransactions: prepared,
      investmentTransactions: [],
      selectedIndices: new Set(prepared.map((_, i) => i)),
      duplicateIndices: new Set(),
      ctx: {
        accounts,
        portfolios: [],
        existingBankTransactions: [],
        existingInvestmentTransactions: [],
        sarPerUsd: 3.75,
      },
    });
    expect(plan.validationMessages).toEqual([]);
    expect(plan.skippedValidation).toBe(0);
    expect(plan.importableCount).toBe(28);
  });
});
