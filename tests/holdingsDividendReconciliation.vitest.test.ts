import { describe, expect, it } from 'vitest';
import { buildHoldingsDividendReconciliationReport } from '../services/holdingsDividendReconciliation';
import type { FinancialData } from '../types';

describe('holdingsDividendReconciliation', () => {
  it('flags qty drift when holding differs from ledger', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          currency: 'SAR',
          holdings: [{ id: 'h1', symbol: 'AAPL', quantity: 10, holdingType: 'ticker' }],
        },
      ],
      investmentTransactions: [
        { id: 't1', portfolioId: 'p1', symbol: 'AAPL', type: 'buy', quantity: 8, total: 800, date: '2026-01-01' },
      ],
    } as unknown as FinancialData;
    const report = buildHoldingsDividendReconciliationReport(data);
    expect(report.isClean).toBe(false);
    expect(report.holdingsMismatchCount).toBeGreaterThan(0);
  });
});
