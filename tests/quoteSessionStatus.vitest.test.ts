import { describe, expect, it } from 'vitest';
import {
  nextQuotesPriceSourceAfterTick,
  quotesPriceSourceAfterCacheRehydrate,
} from '../services/quoteSessionStatus';

describe('quoteSessionStatus', () => {
  it('nextQuotesPriceSourceAfterTick upgrades on network but never demotes live', () => {
    expect(nextQuotesPriceSourceAfterTick('cached', true, true)).toBe('live');
    expect(nextQuotesPriceSourceAfterTick('live', false, true)).toBe('live');
    expect(nextQuotesPriceSourceAfterTick('cached', false, true)).toBe('cached');
    expect(nextQuotesPriceSourceAfterTick('none', false, true)).toBe('cached');
    expect(nextQuotesPriceSourceAfterTick('none', false, false)).toBe('none');
  });

  it('quotesPriceSourceAfterCacheRehydrate preserves live session', () => {
    expect(quotesPriceSourceAfterCacheRehydrate('live')).toBe('live');
    expect(quotesPriceSourceAfterCacheRehydrate('cached')).toBe('cached');
    expect(quotesPriceSourceAfterCacheRehydrate('none')).toBe('cached');
  });
});
