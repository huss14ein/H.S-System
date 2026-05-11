import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveQuotePrice } from '../services/finnhubService';
import { getLivePrices } from '../services/geminiService';

describe('Tadawul live price coverage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('VITE_FINNHUB_API_KEY', 'test-key');
    vi.stubEnv('VITE_LIVE_PRICE_PROVIDER', 'finnhub');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolveQuotePrice accepts fallback Finnhub fields when c=0', () => {
    expect(resolveQuotePrice({ c: 0, p: undefined, pc: 42.5, o: 41 })).toBe(42.5);
    expect(resolveQuotePrice({ c: 0, p: 43.25, pc: 42.5, o: 41 })).toBe(43.25);
  });

  it('routes Tadawul symbols to SAHMK instead of Finnhub and returns aliases', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://app.test');
      expect(url.hostname).not.toBe('finnhub.io');
      if (url.pathname.endsWith('/sahmk-proxy')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ price: 50, previous_close: 50 }),
          headers: new Headers(),
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    }) as typeof fetch;

    const prices = await getLivePrices(['2222.SA']);
    expect(prices['2222.SA']?.price).toBe(50);
    expect(prices['2222.SR']?.price).toBe(50);
    expect(prices['2222.SE']?.price).toBe(50);
    expect(prices['2222.SA']?.change).toBe(0);
    expect(prices['2222.SA']?.changePercent).toBe(0);
  });
});
