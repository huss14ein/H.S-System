import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';

beforeEach(() => {
  // Ensure every test starts from the same AI mock behavior.
  vi.mocked(invokeAI).mockReset();
  vi.mocked(invokeAI).mockResolvedValue({ text: '[]' } as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('parseSMSTransactions', () => {
  it('extracts multiline Arabic/English POS SMS blocks via heuristic parser', async () => {
    const sms = `شراء عبر نقاط البيع\nبطاقة: 4396; فيزا-أثير\nلدى:DUBAI PLA\nSAR مبلغ:5.75\nSAR رصيد:593.65\n19:56 8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-1');
    expect(res.transactions.length).toBeGreaterThan(0);
    const tx = res.transactions[0];
    expect(tx.accountId).toBe('acc-1');
    expect(tx.amount).toBeCloseTo(-5.75, 2);
    expect(tx.description.toUpperCase()).toBe('DUBAI PLA');
    expect(tx.type).toBe('expense');
    expect(tx.date).toBe('2026-04-08');
  });

  it('extracts multiple SMS transactions even without blank lines between messages', async () => {
    const sms = `شراء عبر نقاط البيع
لدى:DUBAI PLA
SAR مبلغ:5.75
8/4/26
Payment at CAFE NERO
SAR 21.50
9/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-2');
    expect(res.transactions.length).toBeGreaterThanOrEqual(2);
    expect(res.transactions.some((t) => t.category === 'Shopping')).toBe(true);
  });

  it('adds timeout warning when SMS AI extraction exceeds budget (AI only runs if parsers find nothing)', async () => {
    vi.useFakeTimers();
    const abortSpy = vi.fn();
    vi.mocked(invokeAI).mockImplementation((payload: any) => new Promise((resolve, reject) => {
      payload?.signal?.addEventListener('abort', () => {
        abortSpy();
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const sms =
      'ZZ_UNPARSEABLE_NOTIFICATION ref 9x7k no SAR amount line that parsers skip';
    const pending = parseSMSTransactions(sms, 'acc-3');
    await vi.advanceTimersByTimeAsync(12100);
    const res = await pending;
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(res.warnings?.join(' ')).toContain('timed out');
  });


  it('prioritizes transaction amount markers over balance values', async () => {
    const sms = `رصيد SAR 593.65\nلدى:DUBAI PLA\nSAR مبلغ:5.75\n8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-4');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(Math.abs(res.transactions[0].amount)).toBeCloseTo(5.75, 2);
  });

  it('extracts transactions from compact one-paragraph SMS paste', async () => {
    const sms = `شراء عبر نقاط البيع لدى:DUBAI PLA SAR مبلغ:5.75 SAR رصيد:593.65 19:56 8/4/26 Payment at CAFE NERO SAR 21.50 9/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-5');
    expect(res.transactions.length).toBeGreaterThanOrEqual(2);
    expect(res.transactions.some((t) => Math.abs(t.amount) === 21.5)).toBe(true);
  });

  it('handles Arabic-Indic numerals in SMS amount/date', async () => {
    const sms = `شراء عبر نقاط البيع\nلدى: DUBAI PLA\nSAR مبلغ:٥٫٧٥\n٨/٤/٢٦`;
    const res = await parseSMSTransactions(sms, 'acc-6');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(Math.abs(res.transactions[0].amount)).toBeCloseTo(5.75, 2);
    expect(res.transactions[0].date).toBe('2026-04-08');
  });

  it('parses NBSP-separated SAR amounts and ISO dates (common bank SMS)', async () => {
    const sms =
      'SNB ALAHli\nPurchase SAR\u00a0150.50\nBalance SAR\u00a012,340.00\n2026-04-08 14:22';
    const res = await parseSMSTransactions(sms, 'acc-nbsp');
    expect(res.transactions.length).toBeGreaterThan(0);
    const amounts = res.transactions.map((t) => Math.abs(t.amount)).sort((a, b) => b - a);
    expect(amounts[0]).toBeCloseTo(150.5, 2);
    expect(amounts.every((x) => Math.abs(x - 12340) > 0.01)).toBe(true);
    expect(res.transactions.some((t) => t.date === '2026-04-08')).toBe(true);
  });

  it('never imports balance-only lines as separate expense transactions', async () => {
    const sms =
      'Debit alert\nBalance SAR 8,410.20\n2026-04-08\nPurchase SAR 89.90\nBalance SAR 8,320.30';
    const res = await parseSMSTransactions(sms, 'acc-balance-only');
    const amounts = res.transactions.map((t) => Math.abs(t.amount));
    expect(amounts.some((a) => Math.abs(a - 89.9) < 0.01)).toBe(true);
    expect(amounts.every((a) => Math.abs(a - 8410.2) > 0.01)).toBe(true);
    expect(amounts.every((a) => Math.abs(a - 8320.3) > 0.01)).toBe(true);
  });

  it('parses dotted numeric dates (DD.MM.YYYY)', async () => {
    const sms = `POS Purchase\nMerchant: TEST STORE\nAmt SAR 42.00\nBal SAR 1000.00\n08.04.2026`;
    const res = await parseSMSTransactions(sms, 'acc-dot');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(res.transactions.some((t) => Math.abs(t.amount) === 42)).toBe(true);
    expect(res.transactions.some((t) => t.date === '2026-04-08')).toBe(true);
  });

  it('still extracts SMS when AI extraction fails (pattern/heuristic only)', async () => {
    vi.mocked(invokeAI).mockReset();
    vi.mocked(invokeAI).mockRejectedValueOnce(new Error('network'));
    const sms = `Debit alert\nSAR 75.25 debited\n2026-01-15`;
    const res = await parseSMSTransactions(sms, 'acc-ai-fail');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(Math.abs(res.transactions[0].amount)).toBeCloseTo(75.25, 2);
  });

  it('parses STC/Yaqoot-style Arabic SMS with SR and لـ merchant (RTL marks)', async () => {
    const sms = [
      'شراء إنترنت بـSR 57.5 ',
      'عبر 7365 ;فيزا-ابل باي',
      'لـyaqoot 02',
      'رصيد:1977.14 SR',
      '\u061C17/4/26 8:51',
    ].join('\n');
    const res = await parseSMSTransactions(sms, 'acc-yaqoot');
    expect(res.transactions.length).toBeGreaterThan(0);
    const debit = res.transactions.find((t) => Math.abs(t.amount + 57.5) < 0.01);
    expect(debit).toBeDefined();
    expect(debit!.type).toBe('expense');
    expect(debit!.date).toBe('2026-04-17');
    expect(debit!.description.toLowerCase()).toContain('yaqoot');
  });

  it('parses شراء إنترنت بـSR on single line without \\b-Arabic boundary bug', async () => {
    const sms = 'شراء إنترنت بـSR 57.5\r\nرصيد: 100 SR\r\n17/4/26';
    const res = await parseSMSTransactions(sms, 'acc-br');
    expect(res.transactions.some((t) => Math.abs(t.amount + 57.5) < 0.01)).toBe(true);
  });

  it('prefers deterministic SMS parse when AI returns a duplicate amount for the same date', async () => {
    vi.mocked(invokeAI).mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: '[{"date":"2026-04-08","description":"Unknown POS","amount":-5.75,"type":"expense","category":"Shopping"}]' }] } }],
    });
    const sms = `شراء عبر نقاط البيع\nلدى:DUBAI PLA\nSAR مبلغ:5.75\n8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-ai-dup');
    const debit = Math.abs(-5.75);
    expect(res.transactions.filter((t) => Math.abs(Math.abs(t.amount) - debit) < 0.001).length).toBe(1);
    expect(res.transactions.some((t) => /DUBAI\s+PLA/i.test(t.description))).toBe(true);
  });

  it('uses purchase amount when balance appears on same line after purchase', async () => {
    const sms = 'شراء إنترنت بـSR 57.5 رصيد:1977.14 SR 17/4/26';
    const res = await parseSMSTransactions(sms, 'acc-inline-bal');
    expect(res.transactions.some((t) => Math.abs(t.amount + 57.5) < 0.01)).toBe(true);
    expect(res.transactions.every((t) => Math.abs(t.amount) < 500)).toBe(true);
  });

  it('parses long income amounts without truncating digits', async () => {
    const sms = `Income transfer received
Amount: SAR 20222
Balance SAR 54500
2026-04-22`;
    const res = await parseSMSTransactions(sms, 'acc-income-long');
    expect(res.transactions.length).toBeGreaterThan(0);
    const income = res.transactions.find((t) => t.amount > 0);
    expect(income).toBeDefined();
    expect(income!.amount).toBeCloseTo(20222, 2);
    expect(res.transactions.every((t) => Math.abs(t.amount - 202) > 0.01)).toBe(true);
  });

  it('parses long Arabic SR amounts without truncating digits', async () => {
    const sms = `ايداع راتب
بـSR 20222
رصيد: 54500 SR
22/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-income-long-ar');
    expect(res.transactions.length).toBeGreaterThan(0);
    const income = res.transactions.find((t) => t.amount > 0);
    expect(income).toBeDefined();
    expect(income!.amount).toBeCloseTo(20222, 2);
  });
});
