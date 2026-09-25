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

  it('keeps separate rows when multiple SMS share date and amount but different merchants', async () => {
    const sms = `شراء عبر نقاط البيع
لدى:CAFE NERO
SAR مبلغ:50.00
8/4/26
شراء عبر نقاط البيع
لدى:JARIR BOOK
SAR مبلغ:50.00
8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-multi-same-amt');
    expect(res.transactions.length).toBe(2);
    const descs = res.transactions.map((t) => t.description.toUpperCase());
    expect(descs.some((d) => d.includes('CAFE'))).toBe(true);
    expect(descs.some((d) => d.includes('JARIR'))).toBe(true);
  });

  it('parses Alinma-style hyphen dates as YY-MM-DD when DD-MM-YY would land in 2010', async () => {
    const sms = `144.25 SAR - Apple Pay شراء إنترنت
بطاقة ائتمانية *3282
من : Tamara - SA
في 13:25 26-08-10
1,183.48 الرصيد`;
    const res = await parseSMSTransactions(sms, 'acc-alinma');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(res.transactions[0].date).toBe('2026-08-10');
    expect(res.transactions[0].amount).toBeCloseTo(-144.25, 2);
    expect(res.warnings?.some((w) => w.includes('Very old date'))).not.toBe(true);
  });

  it('still parses visual DD-MM-YY hyphen dates (10-08-26)', async () => {
    const sms = `144.25 SAR - Apple Pay شراء إنترنت
من : Tamara - SA
10-08-26 13:25 في
1,183.48 الرصيد`;
    const res = await parseSMSTransactions(sms, 'acc-alinma-visual');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(res.transactions[0].date).toBe('2026-08-10');
  });

  it('parses outgoing local transfer (حوالة صادرة) as expense including fee, not income', async () => {
    const sms = `حوالة محلية صادرة بـSR 300
من3138
لـ0102;abdullah alsaggaf
رسوم:SR 0.58
26/9/9 20:47`;
    const res = await parseSMSTransactions(sms, 'acc-hawala');
    expect(res.transactions.length).toBe(1);
    const tx = res.transactions[0];
    expect(tx.type).toBe('expense');
    expect(tx.amount).toBeCloseTo(-300.58, 2);
    expect(tx.date).toBe('2026-09-09');
    expect(tx.description.toLowerCase()).toContain('abdullah');
    expect(tx.category).toBe('Transfer');
  });

  it('parses credit-card refund SMS as income (استرداد)', async () => {
    const sms = `بطاقة ائتمانية استرداد مبلغ
بطاقة: 7365; فيزا
مبلغ: 13.45 SAR
التاجر: MAF Carre
في: 5/9/26 10:37`;
    const res = await parseSMSTransactions(sms, 'acc-refund');
    expect(res.transactions.length).toBe(1);
    expect(res.transactions[0].type).toBe('income');
    expect(res.transactions[0].amount).toBeCloseTo(13.45, 2);
    expect(res.transactions[0].description.toUpperCase()).toContain('MAF');
    expect(res.transactions[0].date).toBe('2026-09-05');
  });

  it('uses إجمالي المبلغ المستحق for USD purchase and ignores fee/FX ghost rows', async () => {
    const sms = `شراء انترنت
بطاقة: 5280 ;فيزا
مبلغ: 9 USD (33.81 ريال)
لدى: NETLIFY
رسوم وضريبة: 0.78 SAR
سعر الصرف~ 3.756667
إجمالي المبلغ المستحق: 34.59 SAR
دولة: USA
رصيد: 45993.85 SAR
12/9/26 4:27`;
    const res = await parseSMSTransactions(sms, 'acc-netlify');
    expect(res.transactions.length).toBe(1);
    expect(res.transactions[0].amount).toBeCloseTo(-34.59, 2);
    expect(res.transactions[0].type).toBe('expense');
    expect(res.transactions[0].description.toUpperCase()).toContain('NETLIFY');
    expect(res.transactions.every((t) => Math.abs(t.amount) !== 9)).toBe(true);
    expect(res.transactions.every((t) => Math.abs(Math.abs(t.amount) - 0.78) > 0.01)).toBe(true);
    expect(res.transactions.every((t) => Math.abs(t.amount) < 1000)).toBe(true);
  });

  it('uses اجمالي المبلغ المستحق (no hamza) for Cursor SAR purchase with fees — not pre-fee مبلغ', async () => {
    const sms = `شراء انترنت
بطاقة:5280 ;فيزا-ابل باي
مبلغ: 89.71 SAR
لدى:CURSOR, A
رسوم وضريبة: 2.06 SAR
اجمالي المبلغ المستحق: 91.77 SAR
دولة:USA
رصيد:46947.60 SAR
في:2/9/26 20:46`;
    const res = await parseSMSTransactions(sms, 'acc-cursor');
    expect(res.transactions.length).toBe(1);
    expect(res.transactions[0].amount).toBeCloseTo(-91.77, 2);
    expect(res.transactions[0].type).toBe('expense');
    expect(res.transactions[0].description.toUpperCase()).toContain('CURSOR');
    expect(res.transactions.every((t) => Math.abs(Math.abs(t.amount) - 89.71) > 0.01)).toBe(true);
    expect(res.transactions.every((t) => Math.abs(Math.abs(t.amount) - 2.06) > 0.01)).toBe(true);
  });

  it('does not add a merchant substring (fee/vat) as a same-block fee when total-due is absent', async () => {
    const coffee = `شراء عبر نقاط البيع
بطاقة:7365 ;فيزا
لدى:COFFEE 02
مبلغ:45 SAR
3/9/26 4:06`;
    const coffeeRes = await parseSMSTransactions(coffee, 'acc-coffee');
    expect(coffeeRes.transactions.length).toBe(1);
    expect(coffeeRes.transactions[0].amount).toBeCloseTo(-45, 2);

    const privateMerchant = `شراء عبر نقاط البيع
لدى:PRIVATE 12
مبلغ:45 SAR
3/9/26 4:06`;
    const privateRes = await parseSMSTransactions(privateMerchant, 'acc-private');
    expect(privateRes.transactions[0].amount).toBeCloseTo(-45, 2);

    const englishFee = `شراء عبر نقاط البيع
مبلغ:45 SAR
لدى:SHOP
fee: 2 SAR
3/9/26 4:06`;
    const englishFeeRes = await parseSMSTransactions(englishFee, 'acc-en-fee');
    expect(englishFeeRes.transactions[0].amount).toBeCloseTo(-47, 2);

    const withFee = `شراء انترنت
مبلغ: 89.71 SAR
لدى:CURSOR, A
رسوم وضريبة: 2.06 SAR
في:2/9/26 20:46`;
    const feeRes = await parseSMSTransactions(withFee, 'acc-fee-still');
    expect(feeRes.transactions[0].amount).toBeCloseTo(-91.77, 2);
  });

  it('uses اجمالي المبلغ المستحق (no hamza) for Netlify USD paste with fees', async () => {
    const sms = `شراء انترنت 
بطاقة: 5280 ;فيزا
مبلغ: 9 USD (33.81 ريال) 
لدى: NETLIFY
رسوم وضريبة: 0.78 SAR
سعر الصرف~ 3.756667
اجمالي المبلغ المستحق: 34.59 SAR
دولة: USA
رصيد: 45993.85 SAR
؜ 12/9/26 4:27`;
    const res = await parseSMSTransactions(sms, 'acc-netlify-alef');
    expect(res.transactions.length).toBe(1);
    expect(res.transactions[0].amount).toBeCloseTo(-34.59, 2);
    expect(res.transactions[0].description.toUpperCase()).toContain('NETLIFY');
  });

  it('parses a multi-SMS paste of POS, internet, refund, and transfer as one row each', async () => {
    const sms = `شراء عبر نقاط البيع
بطاقة:7365 ;فيزا
لدى:ALJAZIRA T
مبلغ:500 SAR
رصيد:4232.62 SAR
3/9/26 4:06

شراء إنترنت بـSR 117
عبر7365;فيزا-ابل باي
لـKeeta Tec
رصيد:4129.07 SR
4/9/26 23:23

بطاقة ائتمانية استرداد مبلغ
بطاقة: 7365; فيزا
مبلغ: 13.45 SAR
التاجر: MAF Carre
في: 5/9/26 10:37

شراء عبر نقاط البيع
بطاقة:7365 ;فيزا-ابل باي
لدى:Aramco St
مبلغ:111.19 SAR
رصيد:4017.88 SAR
5/9/26 16:43

شراء عبر نقاط البيع
بطاقة:7365 ;فيزا-أثير
لدى:ROKN MOSH
مبلغ:48 SAR
رصيد:4406.93 SAR
9/9/26 8:34

شراء عبر نقاط البيع
بطاقة:7365 ;فيزا-أثير
لدى:ROKN MOSH
مبلغ:8 SAR
رصيد:4270.03 SAR
11/9/26 22:43

شراء انترنت
بطاقة: 5280 ;فيزا
مبلغ: 9 USD (33.81 ريال)
لدى: NETLIFY
رسوم وضريبة: 0.78 SAR
سعر الصرف~ 3.756667
إجمالي المبلغ المستحق: 34.59 SAR
دولة: USA
رصيد: 45993.85 SAR
12/9/26 4:27

شراء عبر نقاط البيع
بطاقة:7365 ;فيزا-ابل باي
لدى:Almajdoui
مبلغ:3232.31 SAR
رصيد:1037.72 SAR
12/9/26 11:03

حوالة محلية صادرة بـSR 300
من3138
لـ0102;abdullah alsaggaf
رسوم:SR 0.58
26/9/9 20:47`;
    const res = await parseSMSTransactions(sms, 'acc-multi-batch');
    expect(res.transactions.length).toBe(9);

    const byAmt = (n: number) =>
      res.transactions.find((t) => Math.abs(Math.abs(t.amount) - n) < 0.02);

    expect(byAmt(500)?.amount).toBeCloseTo(-500, 2);
    expect(byAmt(500)?.description.toUpperCase()).toContain('ALJAZIRA');
    expect(byAmt(117)?.amount).toBeCloseTo(-117, 2);
    expect(byAmt(117)?.description.toLowerCase()).toContain('keeta');
    expect(byAmt(13.45)?.amount).toBeCloseTo(13.45, 2);
    expect(byAmt(13.45)?.type).toBe('income');
    expect(byAmt(111.19)?.amount).toBeCloseTo(-111.19, 2);
    expect(byAmt(48)?.amount).toBeCloseTo(-48, 2);
    expect(byAmt(8)?.amount).toBeCloseTo(-8, 2);
    expect(byAmt(34.59)?.amount).toBeCloseTo(-34.59, 2);
    expect(byAmt(3232.31)?.amount).toBeCloseTo(-3232.31, 2);
    expect(byAmt(300.58)?.amount).toBeCloseTo(-300.58, 2);
    expect(byAmt(300.58)?.type).toBe('expense');

    // No balance / fee / USD ghosts
    const absAmts = res.transactions.map((t) => Math.abs(t.amount));
    expect(absAmts.every((a) => a !== 9)).toBe(true);
    expect(absAmts.every((a) => Math.abs(a - 0.78) > 0.01)).toBe(true);
    expect(absAmts.every((a) => Math.abs(a - 4232.62) > 0.01)).toBe(true);
    expect(absAmts.every((a) => Math.abs(a - 45993.85) > 0.01)).toBe(true);
  });

  it('parses multi-SMS without blank lines between Arabic starters', async () => {
    const sms = `شراء عبر نقاط البيع
لدى:ALJAZIRA T
مبلغ:500 SAR
3/9/26 4:06
شراء إنترنت بـSR 117
لـKeeta Tec
4/9/26 23:23
حوالة محلية صادرة بـSR 50
لـ0102;test user
26/9/25 12:00`;
    const res = await parseSMSTransactions(sms, 'acc-no-blank');
    expect(res.transactions.length).toBe(3);
    expect(res.transactions.some((t) => Math.abs(t.amount + 500) < 0.01)).toBe(true);
    expect(res.transactions.some((t) => Math.abs(t.amount + 117) < 0.01)).toBe(true);
    expect(res.transactions.some((t) => t.amount < 0 && Math.abs(Math.abs(t.amount) - 50) < 0.01)).toBe(true);
  });

  it('parses شراء PoS with بـSAR on a separate line (mada Apple Pay)', async () => {
    const sms = [
      'شراء PoS',
      'عبر:8529;مدى-ابل باي',
      'بـSAR 260',
      'لـMohammed I',
      '\u061C6/9/26 19:15',
      'شراء PoS',
      'عبر:8529;مدى-ابل باي',
      'بـSAR 3',
      'لـAl-Imtiaz',
      '\u061C6/9/26 19:33',
      'شراء PoS',
      'عبر:8529;مدى-ابل باي',
      'بـSAR 15.64',
      'لـHANAA ROA',
      '\u061C6/9/26 19:37',
    ].join('\n');
    const res = await parseSMSTransactions(sms, 'acc-pos-sar');
    expect(res.transactions.length).toBe(3);
    const byAmt = (n: number) => res.transactions.find((t) => Math.abs(Math.abs(t.amount) - n) < 0.01);
    expect(byAmt(260)?.amount).toBeCloseTo(-260, 2);
    expect(byAmt(260)?.type).toBe('expense');
    expect(byAmt(260)?.description.toLowerCase()).toContain('mohammed');
    expect(byAmt(260)?.category).toBe('Shopping');
    expect(byAmt(260)?.date).toBe('2026-09-06');
    expect(byAmt(3)?.amount).toBeCloseTo(-3, 2);
    expect(byAmt(3)?.description).toMatch(/Al-Imtiaz/i);
    expect(byAmt(15.64)?.amount).toBeCloseTo(-15.64, 2);
    expect(byAmt(15.64)?.description.toUpperCase()).toContain('HANAA');
    expect(res.transactions.every((t) => t.type === 'expense' && t.category === 'Shopping')).toBe(true);
  });
});
