import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAICommodityPrices } from '../services/geminiService';

describe('commodity price routing', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not call Finnhub/OANDA for gold spot prices', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).not.toBe('finnhub.io');
      expect(url.search).not.toContain('OANDA');
      if (url.hostname === 'api.coingecko.com') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ 'pax-gold': { usd: 2000 } }),
          headers: new Headers(),
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    }) as typeof fetch;

    const res = await getAICommodityPrices([{ symbol: 'XAU_GRAM_24K', name: 'Gold 24K', goldKarat: 24 }], {
      sarPerUsd: 3.75,
    });

    expect(res.prices[0]?.symbol).toBe('XAU_GRAM_24K');
    expect(res.prices[0]?.price).toBeCloseTo((2000 * 3.75) / 31.1035, 6);
  });
});
