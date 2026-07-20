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

  it('flags drift after buy then sell when held qty is wrong', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          currency: 'USD',
          holdings: [{ id: 'h1', symbol: 'LCID', quantity: 100, holdingType: 'ticker' }],
        },
      ],
      investmentTransactions: [
        { id: 'b1', portfolioId: 'p1', symbol: 'LCID', type: 'buy', quantity: 100, total: 500, date: '2026-01-01' },
        { id: 's1', portfolioId: 'p1', symbol: 'LCID', type: 'sell', quantity: 40, total: 280, date: '2026-02-01' },
      ],
    } as unknown as FinancialData;
    const report = buildHoldingsDividendReconciliationReport(data);
    expect(report.isClean).toBe(false);
    expect(report.holdingsMismatchCount).toBeGreaterThan(0);
    expect(report.rows[0]?.expected).toBe(60);
    expect(report.rows[0]?.actual).toBe(100);
  });

  it('accepts matching buy/sell ledger vs holding', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          currency: 'USD',
          holdings: [{ id: 'h1', symbol: 'AAPL', quantity: 5, holdingType: 'ticker' }],
        },
      ],
      investmentTransactions: [
        { id: 'b1', portfolioId: 'p1', symbol: 'AAPL', type: 'buy', quantity: '12', total: 1200, date: '2026-01-01' },
        { id: 's1', portfolioId: 'p1', symbol: 'AAPL', type: 'sell', quantity: 7, total: 700, date: '2026-03-01' },
      ],
    } as unknown as FinancialData;
    const report = buildHoldingsDividendReconciliationReport(data);
    expect(report.isClean).toBe(true);
    expect(report.holdingsMismatchCount).toBe(0);
  });
});
