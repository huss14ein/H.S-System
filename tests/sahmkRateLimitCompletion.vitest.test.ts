/**
 * SAHMK rate-limit + batch caps — permanent guards against 429 storms / UI hangs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getSahmkLivePrices,
  resetSahmkQuoteCacheForTests,
  SAHMK_MAX_CODES_PER_BATCH,
} from '../services/sahmkQuote';
import {
  isQuoteRefreshInCooldown,
  quoteRefreshCooldownRemainingMs,
  resetQuoteRefreshCooldownForTests,
  SAHMK_RATE_LIMIT_COOLDOWN_MS,
} from '../services/quoteRefreshCooldown';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

vi.mock('../services/sahmkClient', () => ({
  fetchSahmkQuote: vi.fn(),
}));

import { fetchSahmkQuote } from '../services/sahmkClient';

describe('SAHMK rate limit permanent guards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetQuoteRefreshCooldownForTests();
    resetSahmkQuoteCacheForTests();
    vi.mocked(fetchSahmkQuote).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetQuoteRefreshCooldownForTests();
    resetSahmkQuoteCacheForTests();
  });

  it('aborts batch on first 429 and starts long SAHMK cooldown', async () => {
    vi.mocked(fetchSahmkQuote).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response);

    await expect(getSahmkLivePrices(['2222.SR', '2223.SR', '2224.SR'])).rejects.toThrow(/SAHMK rate limit/);
    expect(fetchSahmkQuote).toHaveBeenCalledTimes(1);
    expect(isQuoteRefreshInCooldown()).toBe(true);
    expect(quoteRefreshCooldownRemainingMs()).toBeGreaterThan(SAHMK_RATE_LIMIT_COOLDOWN_MS - 5_000);
  });

  it('skips network entirely while cooldown is active', async () => {
    const { startQuoteRefreshCooldown } = await import('../services/quoteRefreshCooldown');
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS);
    const out = await getSahmkLivePrices(['2222.SR']);
    expect(out).toEqual({});
    expect(fetchSahmkQuote).not.toHaveBeenCalled();
  });

  it('caps distinct SAHMK codes per batch', () => {
    expect(SAHMK_MAX_CODES_PER_BATCH).toBeLessThanOrEqual(8);
    expect(read('services/sahmkQuote.ts')).toContain('SAHMK_MAX_CODES_PER_BATCH');
    expect(read('services/sahmkQuote.ts')).toContain('break');
  });

  it('getLivePrices does not throw SAHMK 429 (keeps Finnhub results)', () => {
    const gemini = read('services/geminiService.ts');
    expect(gemini).toContain('startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS)');
    expect(gemini).toContain('serving cache until cooldown ends');
    const trySahmk = gemini.slice(gemini.indexOf('const trySahmk'), gemini.indexOf('const mergeFinnhubStooqAndSahmk'));
    expect(trySahmk).toContain('return {}');
    expect(trySahmk).not.toContain('throw e');
  });

  it('MarketSimulator never bypasses cooldown for manual forceFetch', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('const rateLimited = isQuoteRefreshInCooldown()');
    expect(sim).not.toContain('!(priceScope.manual === true && forceFetch)');
  });

  it('proxy caches 429 for the long SAHMK cooldown window', () => {
    expect(read('netlify/functions/sahmk-proxy.ts')).toContain('10 * 60 * 1000');
  });
});
