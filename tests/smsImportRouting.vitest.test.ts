import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import {
  applySmsAccountRouting,
  extractSmsCardLast4,
  findAccountsByCardLast4,
  normalizeCardLast4,
} from '../services/smsImportRouting';
import { parseSMSTransactions } from '../services/statementParser';
import type { Account, Transaction } from '../types';

describe('smsImportRouting', () => {
  it('extracts last-4 from بطاقة / عبر / من / * masks', () => {
    expect(extractSmsCardLast4('بطاقة:7365 ;فيزا\nمبلغ:500')).toBe('7365');
    expect(extractSmsCardLast4('عبر:8529;مدى-ابل باي\nبـSAR 260')).toBe('8529');
    expect(extractSmsCardLast4('عبر7365;فيزا-ابل باي')).toBe('7365');
    expect(extractSmsCardLast4('من3138\nلـ0102;user')).toBe('3138');
    expect(extractSmsCardLast4('بطاقة ائتمانية *3282')).toBe('3282');
    expect(normalizeCardLast4('xx7365yy')).toBe('7365');
  });

  it('routes SMS rows to accounts by lastFourDigits', () => {
    const accounts: Account[] = [
      { id: 'acc-a', name: 'Card A', type: 'Checking', balance: 1000, lastFourDigits: '7365' },
      { id: 'acc-b', name: 'Card B', type: 'Credit', balance: -200, lastFourDigits: '5280' },
      { id: 'acc-fallback', name: 'Main', type: 'Checking', balance: 5000 },
    ];
    const txs: Transaction[] = [
      {
        id: '1',
        date: '2026-09-12',
        description: 'NETLIFY',
        amount: -34.59,
        category: 'Shopping',
        accountId: 'acc-fallback',
        type: 'expense',
        note: 'sms:card=5280',
      },
      {
        id: '2',
        date: '2026-09-03',
        description: 'ALJAZIRA',
        amount: -500,
        category: 'Shopping',
        accountId: 'acc-fallback',
        type: 'expense',
        note: 'sms:card=7365',
      },
    ];
    const routed = applySmsAccountRouting(txs, accounts, 'acc-fallback');
    expect(routed.matchedCount).toBe(2);
    expect(routed.transactions.find((t) => t.description === 'NETLIFY')?.accountId).toBe('acc-b');
    expect(routed.transactions.find((t) => t.description === 'ALJAZIRA')?.accountId).toBe('acc-a');
    expect(findAccountsByCardLast4(accounts, '7365')[0]?.id).toBe('acc-a');
  });

  it('warns when paste spans multiple unmatched cards', () => {
    const accounts: Account[] = [
      { id: 'acc-fallback', name: 'Main', type: 'Checking', balance: 5000 },
    ];
    const txs: Transaction[] = [
      {
        id: '1',
        date: '2026-09-06',
        description: 'A',
        amount: -10,
        category: 'Shopping',
        accountId: 'acc-fallback',
        type: 'expense',
        note: 'sms:card=8529',
      },
      {
        id: '2',
        date: '2026-09-06',
        description: 'B',
        amount: -20,
        category: 'Shopping',
        accountId: 'acc-fallback',
        type: 'expense',
        note: 'sms:card=7365',
      },
    ];
    const routed = applySmsAccountRouting(txs, accounts, 'acc-fallback');
    expect(routed.unmatchedLast4.sort()).toEqual(['7365', '8529']);
    expect(routed.warnings.some((w) => /2 different cards/i.test(w))).toBe(true);
    expect(routed.warnings.some((w) => /No account last-4/i.test(w))).toBe(true);
  });
});

describe('parseSMSTransactions card routing', () => {
  it('assigns accountId from matching lastFourDigits for mixed-card paste', async () => {
    const accounts: Account[] = [
      { id: 'acc-7365', name: 'Visa 7365', type: 'Checking', balance: 1000, lastFourDigits: '7365' },
      { id: 'acc-5280', name: 'Visa 5280', type: 'Credit', balance: -100, lastFourDigits: '5280' },
    ];
    const sms = `شراء عبر نقاط البيع
بطاقة:7365 ;فيزا
لدى:ALJAZIRA T
مبلغ:500 SAR
3/9/26 4:06

شراء انترنت
بطاقة: 5280 ;فيزا
مبلغ: 9 USD (33.81 ريال)
لدى: NETLIFY
إجمالي المبلغ المستحق: 34.59 SAR
12/9/26 4:27`;
    const res = await parseSMSTransactions(sms, 'acc-7365', { accounts });
    expect(res.transactions.length).toBe(2);
    const pos = res.transactions.find((t) => Math.abs(t.amount + 500) < 0.01);
    const netlify = res.transactions.find((t) => Math.abs(t.amount + 34.59) < 0.01);
    expect(pos?.accountId).toBe('acc-7365');
    expect(netlify?.accountId).toBe('acc-5280');
  });
});
