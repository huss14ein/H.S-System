/**
 * Finnhub profile2 cache — static-first names, service-level TTL cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCompanyProfileCached,
  clearCompanyProfileCacheForTests,
} from '../services/finnhubService';
import {
  clearCompanyNameHookCacheForTests,
  symbolsNeedingCompanyName,
} from '../hooks/useSymbolCompanyName';

describe('finnhub profile cache', () => {
  beforeEach(() => {
    clearCompanyProfileCacheForTests();
    clearCompanyNameHookCacheForTests();
    vi.restoreAllMocks();
    vi.stubEnv('VITE_FINNHUB_API_KEY', 'test-finnhub-key');
  });

  it('getCompanyProfileCached returns same promise for concurrent calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          name: 'Test Co',
          country: 'US',
          currency: 'USD',
          exchange: 'NASDAQ',
          finnhubIndustry: 'Tech',
          ipo: '2020',
          logo: '',
          phone: '',
          shareOutstanding: 1,
          ticker: 'TEST',
          weburl: '',
        }),
        { status: 200 },
      );
    });

    const [a, b] = await Promise.all([
      getCompanyProfileCached('TEST'),
      getCompanyProfileCached('TEST'),
    ]);
    expect(a?.name).toBe('Test Co');
    expect(b?.name).toBe('Test Co');
    const profileCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/stock/profile2'));
    expect(profileCalls.length).toBe(1);
  });

  it('symbolsNeedingCompanyName skips holdings that already have a name', () => {
    const syms = symbolsNeedingCompanyName([
      { symbol: 'AAPL', name: 'Apple Inc.' },
      { symbol: 'MSFT' },
    ]);
    expect(syms).toEqual(['MSFT']);
  });
});
