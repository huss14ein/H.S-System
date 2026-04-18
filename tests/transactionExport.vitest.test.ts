import { describe, expect, it } from 'vitest';
import { exportCashTransactionsToCsv } from '../services/reportingEngine';

describe('exportCashTransactionsToCsv', () => {
  it('emits a header and one row per transaction with account name', () => {
    const csv = exportCashTransactionsToCsv([
      {
        id: 't1',
        date: '2026-04-10',
        description: 'Test',
        amount: -50.5,
        category: 'Food',
        accountId: 'a1',
        accountName: 'Checking',
        type: 'expense',
        status: 'Approved',
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('date');
    expect(lines[0]).toContain('accountName');
    expect(lines[1]).toContain('2026-04-10');
    expect(lines[1]).toContain('Checking');
    expect(lines[1]).toContain('-50.5');
  });
});
