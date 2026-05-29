import { describe, it, expect } from 'vitest';
import { mergePriceRefreshScope } from '../services/quoteRefreshQueue';
import type { PriceRefreshScope } from '../context/MarketDataContext';

describe('mergePriceRefreshScope', () => {
  it('coalesces duplicate all scopes', () => {
    const queue: PriceRefreshScope[] = [{ kind: 'all' }];
    const { queue: next, changed } = mergePriceRefreshScope(queue, { kind: 'all' });
    expect(changed).toBe(false);
    expect(next).toEqual([{ kind: 'all' }]);
  });

  it('upgrades all scope to forceFetch when requested', () => {
    const queue: PriceRefreshScope[] = [{ kind: 'all' }];
    const { queue: next, changed } = mergePriceRefreshScope(queue, { kind: 'all', forceFetch: true });
    expect(changed).toBe(true);
    expect(next).toEqual([{ kind: 'all', forceFetch: true }]);
  });

  it('merges symbols scopes and dedupes tickers', () => {
    const queue: PriceRefreshScope[] = [{ kind: 'symbols', symbols: ['AAPL', 'MSFT'] }];
    const { queue: next, changed } = mergePriceRefreshScope(queue, {
      kind: 'symbols',
      symbols: ['MSFT', 'GOOG'],
    });
    expect(changed).toBe(true);
    expect(next).toEqual([{ kind: 'symbols', symbols: ['AAPL', 'MSFT', 'GOOG'] }]);
  });

  it('dedupes platform scopes by account id', () => {
    const queue: PriceRefreshScope[] = [{ kind: 'platform', platformId: 'acc-1' }];
    const { queue: next, changed } = mergePriceRefreshScope(queue, {
      kind: 'platform',
      platformId: 'acc-1',
    });
    expect(changed).toBe(false);
    expect(next).toHaveLength(1);
  });
});
