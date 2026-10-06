import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import {
  smsTextLooksLikeAtmWithdrawal,
  smsTextLooksLikeCardSettlement,
  smsTextLooksLikeAccountTransferOut,
} from '../services/smsBankTransferPatterns';
import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';
import { shouldImportSmsAtmAsTransfer, parseSmsAtmCashToFromNote } from '../services/smsAtmCashTransfer';
import {
  shouldImportSmsCcPaymentAsTransfer,
  parseSmsCcFundedFromNote,
} from '../services/smsCcPaymentTransfer';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import type { Account } from '../types';

beforeEach(() => {
  vi.mocked(invokeAI).mockReset();
  vi.mocked(invokeAI).mockResolvedValue({ text: '[]' } as any);
});

const fundingAccounts: Account[] = [
  { id: 'cc-1', name: 'Visa 7365', type: 'Credit', balance: -2000, lastFourDigits: '7365' },
  { id: 'cc-2', name: 'Card 3282', type: 'Credit', balance: -500, lastFourDigits: '3282' },
  {
    id: 'chk-1',
    name: 'Main Checking',
    type: 'Checking',
    balance: 20000,
    lastFourDigits: '3138',
    accountRole: 'debt_servicing',
  },
  { id: 'mada-1', name: 'Mada 8529', type: 'Checking', balance: 5000, lastFourDigits: '8529' },
  { id: 'cash-1', name: 'Cash', type: 'Checking', balance: 100, accountRole: 'physical_cash' },
];

describe('smsBankTransferPatterns (multi-bank)', () => {
  it('detects ATM withdrawals across Arabic and English bank templates', () => {
    expect(smsTextLooksLikeAtmWithdrawal('سحب:صراف آلي بSR 450')).toBe(true);
    expect(smsTextLooksLikeAtmWithdrawal('سحب نقدي من جهاز الصراف بمبلغ 300')).toBe(true);
    expect(smsTextLooksLikeAtmWithdrawal('Cash withdrawal ATM SAR 500')).toBe(true);
    expect(smsTextLooksLikeAtmWithdrawal('ATM cash withdrawal SAR 200')).toBe(true);
    expect(smsTextLooksLikeAtmWithdrawal('Withdrawn from ATM SAR 100')).toBe(true);
    expect(smsTextLooksLikeAtmWithdrawal('شراء عبر نقاط البيع لدى CAFE')).toBe(false);
    expect(smsTextLooksLikeAtmWithdrawal('Purchase SAR 150.50')).toBe(false);
  });

  it('detects outgoing حوالة / local transfers without matching POS', () => {
    expect(smsTextLooksLikeAccountTransferOut('حوالة محلية صادرة بـSR 2500')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('حوالة داخلية صادرة بـSR 5500')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('Local transfer out SAR 100')).toBe(true);
    expect(smsTextLooksLikeAccountTransferOut('شراء عبر نقاط البيع لدى CAFE')).toBe(false);
  });

  it('detects card settlements across banks without matching POS payments', () => {
    expect(smsTextLooksLikeCardSettlement('بطاقة فيزا:سداد بـSR 1000')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('تم سداد بطاقتك الائتمانية بمبلغ 500 SAR')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('سداد بطاقة ائتمان Visa *7365')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('Credit card payment SAR 1500 received')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('Payment received on your credit card *1234')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('Card payment received SAR 200')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('Your credit card ending 7365 has been credited')).toBe(true);
    expect(smsTextLooksLikeCardSettlement('Purchase SAR 150.50')).toBe(false);
    expect(smsTextLooksLikeCardSettlement('شراء عبر نقاط البيع')).toBe(false);
    expect(smsTextLooksLikeCardSettlement('STC Payment of SAR 57')).toBe(false);
  });
});

describe('parseSMSTransactions multi-bank ATM + CC payment transfers', () => {
  it('imports Al Rajhi ATM + سداد as transfers', async () => {
    const sms = `بطاقة فيزا:سداد بـSR 1000
عبر7365;فيزا
25/9/26 21:25
سحب:صراف آلي بSR 450
عبر8529;مدى
منCA-ALFALAH BR. 2
13/9/26 22:03`;
    const res = await parseSMSTransactions(sms, '', { accounts: fundingAccounts });
    const sadad = res.transactions.find((t) => Math.abs(t.amount - 1000) < 0.01)!;
    const atm = res.transactions.find((t) => Math.abs(t.amount + 450) < 0.01)!;
    expect(shouldImportSmsCcPaymentAsTransfer(sadad)).toBe(true);
    expect(shouldImportSmsAtmAsTransfer(atm)).toBe(true);
  });

  it('imports SNB-style English credit card payment + ATM as transfers', async () => {
    const sms = `SNB ALAHli
Credit card payment SAR 1500.00 received
Card *7365
Balance SAR 12,340.00
2026-09-25 14:22

SNB ALAHli
ATM cash withdrawal SAR 400.00
Card *8529
2026-09-13 22:03`;
    const res = await parseSMSTransactions(sms, '', { accounts: fundingAccounts });
    const pay = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 1500) < 0.01);
    const atm = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 400) < 0.01);
    expect(pay).toBeDefined();
    expect(atm).toBeDefined();
    expect(pay!.amount).toBeGreaterThan(0);
    expect(pay!.category).toBe('Transfer');
    expect(pay!.note).toContain('sms:kind=cc_payment');
    expect(parseSmsCcFundedFromNote(pay!.note)).toBe('chk-1');
    expect(shouldImportSmsCcPaymentAsTransfer(pay!)).toBe(true);

    expect(atm!.amount).toBeLessThan(0);
    expect(atm!.category).toBe('Transfer');
    expect(atm!.note).toContain('sms:kind=atm');
    expect(parseSmsAtmCashToFromNote(atm!.note)).toBe('cash-1');
    expect(shouldImportSmsAtmAsTransfer(atm!)).toBe(true);

    for (const tx of [pay!, atm!]) {
      const mapped = categorizeImportedTransaction(tx, {
        budgetCategoryNames: ['Food & Dining', 'Shopping'],
      });
      expect(mapped.category).toBe('Transfer');
      expect(mapped.budgetCategory).toBeUndefined();
    }
  });

  it('imports Alinma-style Arabic card settlement + cash withdrawal as transfers', async () => {
    const sms = `تم سداد بطاقتك الائتمانية بمبلغ 500 SAR
بطاقة ائتمانية *3282
في 21:25 26-09-25
1,200.00 الرصيد

سحب نقدي من جهاز الصراف بمبلغ 300 SAR
بطاقة *8529
في 22:03 26-09-13`;
    const res = await parseSMSTransactions(sms, '', { accounts: fundingAccounts });
    const pay = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 500) < 0.01);
    const atm = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 300) < 0.01);
    expect(pay).toBeDefined();
    expect(atm).toBeDefined();
    expect(pay!.amount).toBeGreaterThan(0);
    expect(pay!.type).toBe('income');
    expect(pay!.category).toBe('Transfer');
    expect(shouldImportSmsCcPaymentAsTransfer(pay!)).toBe(true);
    expect(atm!.amount).toBeLessThan(0);
    expect(atm!.category).toBe('Transfer');
    expect(shouldImportSmsAtmAsTransfer(atm!)).toBe(true);
  });

  it('imports SABB/BSF-style English card payment as transfer', async () => {
    const sms = `SABB
Paid towards your credit card
Amount SAR 250.00
Card ending 7365
25/09/2026 10:15`;
    const res = await parseSMSTransactions(sms, '', { accounts: fundingAccounts });
    expect(res.transactions.length).toBeGreaterThan(0);
    const pay = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 250) < 0.01);
    expect(pay).toBeDefined();
    expect(pay!.amount).toBeGreaterThan(0);
    expect(pay!.category).toBe('Transfer');
    expect(pay!.note).toMatch(/sms:kind=cc_payment/);
    expect(pay!.accountId).toBe('cc-1');
    expect(parseSmsCcFundedFromNote(pay!.note)).toBe('chk-1');
    expect(shouldImportSmsCcPaymentAsTransfer(pay!)).toBe(true);
  });

  it('does not treat ordinary SNB purchase SMS as card settlement transfer', async () => {
    const sms =
      'SNB ALAHli\nPurchase SAR\u00a0150.50\nBalance SAR\u00a012,340.00\n2026-04-08 14:22';
    const res = await parseSMSTransactions(sms, '', { accounts: fundingAccounts });
    const purchase = res.transactions.find((t) => Math.abs(Math.abs(t.amount) - 150.5) < 0.01);
    expect(purchase).toBeDefined();
    expect(shouldImportSmsCcPaymentAsTransfer(purchase!)).toBe(false);
    expect(shouldImportSmsAtmAsTransfer(purchase!)).toBe(false);
  });
});
