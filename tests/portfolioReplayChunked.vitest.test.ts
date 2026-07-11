/**
 * Portfolio replay engine — chunked chronological rebuild.
 */
import { describe, it, expect } from 'vitest';
import { rebuildPortfolioFromEvents } from '../services/portfolioReplayEngine';

describe('portfolioReplayChunked', () => {
  it('rebuilds holdings after stock split', async () => {
    const result = await rebuildPortfolioFromEvents({
      transactions: [
        {
          id: 't1',
          accountId: 'a1',
          date: '2026-01-01',
          type: 'buy',
          symbol: 'AAPL',
          quantity: 10,
          price: 100,
          total: 1000,
        },
      ],
      corporateActions: [
        {
          id: 'ca1',
          executionDate: '2026-06-01',
          symbol: 'AAPL',
          action: { type: 'stock_split', ratioNumerator: 2, ratioDenominator: 1 },
        },
      ],
    });
    const h = result.holdings.get('AAPL');
    expect(h?.quantity).toBeCloseTo(20, 4);
    expect(h?.avgCost).toBeCloseTo(50, 4);
  });

  it('yields between chunks for large timelines', async () => {
    const txs = Array.from({ length: 250 }, (_, i) => ({
      id: `t${i}`,
      accountId: 'a1',
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      type: 'deposit' as const,
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 1,
    }));
    const progress: number[] = [];
    await rebuildPortfolioFromEvents({
      transactions: txs,
      corporateActions: [],
      onProgress: (p) => progress.push(p),
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(100);
  });
});
