import { describe, expect, it } from 'vitest';
import { rehydrateSessionPricesFromQuoteCache } from '../services/cachedQuoteRestore';

describe('rehydrateSessionPricesFromQuoteCache', () => {
  it('merges persisted rows into session prices', () => {
    const rows = {
      AAPL: { price: 150, change: 1, changePercent: 0.5, fetchedAt: Date.now() },
    };
    const { prices, changed, lastUpdated } = rehydrateSessionPricesFromQuoteCache({}, rows);
    expect(changed).toBe(true);
    expect(prices.AAPL?.price).toBe(150);
    expect(lastUpdated).toBeInstanceOf(Date);
  });

  it('is no-op when session already matches cache', () => {
    const rows = {
      MSFT: { price: 400, change: 0, changePercent: 0, fetchedAt: Date.now() },
    };
    const prev = { MSFT: { price: 400, change: 0, changePercent: 0 } };
    const { prices, changed } = rehydrateSessionPricesFromQuoteCache(prev, rows);
    expect(changed).toBe(false);
    expect(prices).toBe(prev);
  });
});
