import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QUOTE_CACHE_STORAGE_KEY,
  QUOTE_CACHE_TTL_MS,
  isQuoteFresh,
  loadQuoteCacheRows,
  saveQuoteCacheRows,
  symbolsNeedingLiveFetch,
  resolveSymbolsToLiveFetch,
  upsertCacheFromLiveQuotes,
  cacheRowsToSimulatedMap,
  persistFetchedLiveQuotes,
  persistCommodityQuotePrices,
  buildDisplayMapFromCachedRows,
} from '../services/quotePriceCache';

function mockLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal(
    'localStorage',
    {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    } as Storage,
  );
}

describe('quotePriceCache', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it('persists and reloads rows round-trip', () => {
    const prior = loadQuoteCacheRows();
    const next = upsertCacheFromLiveQuotes(prior, ['AAPL'], {
      AAPL: { price: 100, change: 1, changePercent: 1 },
    });
    saveQuoteCacheRows(next);
    expect(localStorage.getItem(QUOTE_CACHE_STORAGE_KEY)).toBeTruthy();
    const loaded = loadQuoteCacheRows();
    expect(loaded.AAPL?.price).toBe(100);
    expect(loaded.AAPL?.fetchedAt).toBeGreaterThan(0);
  });

  it('symbolsNeedingLiveFetch skips fresh symbols', () => {
    const now = Date.now();
    const rows = {
      AAPL: { price: 10, change: 0, changePercent: 0, fetchedAt: now },
    };
    expect(symbolsNeedingLiveFetch(['AAPL'], rows, QUOTE_CACHE_TTL_MS)).toEqual([]);
  });

  it('resolveSymbolsToLiveFetch forceFetch bypasses fresh cache', () => {
    const now = Date.now();
    const rows = {
      AAPL: { price: 10, change: 0, changePercent: 0, fetchedAt: now },
    };
    expect(resolveSymbolsToLiveFetch(['AAPL'], rows, { forceFetch: true })).toEqual(['AAPL']);
    expect(resolveSymbolsToLiveFetch(['AAPL'], rows)).toEqual([]);
  });

  it('symbolsNeedingLiveFetch requests stale symbols', () => {
    const staleTs = Date.now() - QUOTE_CACHE_TTL_MS - 60_000;
    const rows = {
      MSFT: { price: 200, change: 0, changePercent: 0, fetchedAt: staleTs },
    };
    expect(symbolsNeedingLiveFetch(['MSFT'], rows, QUOTE_CACHE_TTL_MS)).toEqual(['MSFT']);
  });

  it('isQuoteFresh respects TTL boundary', () => {
    const fresh = { price: 1, change: 0, changePercent: 0, fetchedAt: Date.now() };
    expect(isQuoteFresh(fresh, QUOTE_CACHE_TTL_MS)).toBe(true);
    expect(
      isQuoteFresh(
        { ...fresh, fetchedAt: Date.now() - QUOTE_CACHE_TTL_MS - 1 },
        QUOTE_CACHE_TTL_MS,
      ),
    ).toBe(false);
  });

  it('persistFetchedLiveQuotes saves every successful API symbol', () => {
    const prior = loadQuoteCacheRows();
    const next = persistFetchedLiveQuotes(prior, ['AAPL', 'MSFT'], {
      AAPL: { price: 101, change: 1, changePercent: 1 },
    });
    expect(next.AAPL?.price).toBe(101);
    expect(loadQuoteCacheRows().AAPL?.price).toBe(101);
    expect(symbolsNeedingLiveFetch(['AAPL'], loadQuoteCacheRows())).toEqual([]);
  });

  it('persistCommodityQuotePrices stores commodity symbols', () => {
    const prior = loadQuoteCacheRows();
    const next = persistCommodityQuotePrices(prior, [{ symbol: 'XAUUSD', price: 2650 }]);
    expect(next.XAUUSD?.price).toBe(2650);
    expect(loadQuoteCacheRows().XAUUSD?.price).toBe(2650);
  });

  it('buildDisplayMapFromCachedRows returns stale rows until replaced', () => {
    const staleTs = Date.now() - QUOTE_CACHE_TTL_MS - 60_000;
    const rows = {
      MSFT: { price: 420, change: 2, changePercent: 0.5, fetchedAt: staleTs },
    };
    const display = buildDisplayMapFromCachedRows(['MSFT'], rows);
    expect(display.MSFT?.price).toBe(420);
    expect(symbolsNeedingLiveFetch(['MSFT'], rows)).toEqual(['MSFT']);
  });

  it('cacheRowsToSimulatedMap drops invalid rows', () => {
    const rows = {
      BAD: { price: 0, change: 0, changePercent: 0, fetchedAt: 1 },
      OK: { price: 12.5, change: 0, changePercent: 0, fetchedAt: 2 },
    };
    const m = cacheRowsToSimulatedMap(rows);
    expect(m.BAD).toBeUndefined();
    expect(m.OK?.price).toBe(12.5);
  });
});
