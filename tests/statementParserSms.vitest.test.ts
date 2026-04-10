import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';
import { invokeAI } from '../services/geminiService';

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
    expect(res.transactions.some((t) => t.category === 'Food')).toBe(true);
  });

  it('adds timeout warning when AI extraction exceeds 4 seconds', async () => {
    vi.useFakeTimers();
    const abortSpy = vi.fn();
    vi.mocked(invokeAI).mockImplementation((payload: any) => new Promise((resolve, reject) => {
      payload?.signal?.addEventListener('abort', () => {
        abortSpy();
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const sms = `Payment at TEST SHOP\nSAR 10.00\n10/4/26`;
    const pending = parseSMSTransactions(sms, 'acc-3');
    await vi.advanceTimersByTimeAsync(4100);
    const res = await pending;
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(res.warnings?.join(' ')).toContain('timed out');
    expect(res.transactions.length).toBeGreaterThan(0);
  });


  it('prioritizes transaction amount markers over balance values', async () => {
    const sms = `رصيد SAR 593.65\nلدى:DUBAI PLA\nSAR مبلغ:5.75\n8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-4');
    expect(res.transactions.length).toBeGreaterThan(0);
    expect(Math.abs(res.transactions[0].amount)).toBeCloseTo(5.75, 2);
  });
});
