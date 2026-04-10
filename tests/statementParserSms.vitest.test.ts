import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  invokeAI: vi.fn(async () => ({ text: '[]' })),
}));

import { parseSMSTransactions } from '../services/statementParser';

describe('parseSMSTransactions', () => {
  it('extracts multiline Arabic/English POS SMS blocks via heuristic parser', async () => {
    const sms = `شراء عبر نقاط البيع\nبطاقة: 4396; فيزا-أثير\nلدى:DUBAI PLA\nSAR مبلغ:5.75\nSAR رصيد:593.65\n19:56 8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-1');
    expect(res.transactions.length).toBeGreaterThan(0);
    const tx = res.transactions[0];
    expect(tx.accountId).toBe('acc-1');
    expect(tx.amount).toBeCloseTo(-5.75, 2);
    expect(tx.description.toUpperCase()).toContain('DUBAI');
    expect(tx.type).toBe('expense');
  });
});
