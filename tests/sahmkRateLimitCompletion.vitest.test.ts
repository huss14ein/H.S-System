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
  consumeSahmkBatchDeferredSymbols,
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

  it('aborts batch on first 429 and starts long SAHMK-only cooldown', async () => {
    vi.mocked(fetchSahmkQuote).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as Response);

    await expect(getSahmkLivePrices(['2222.SR', '2223.SR', '2224.SR'])).rejects.toThrow(/SAHMK rate limit/);
    // Concurrent wave may hit multiple codes before 429 is observed — still one wave, not the full book.
    expect(fetchSahmkQuote.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchSahmkQuote.mock.calls.length).toBeLessThanOrEqual(3);
    expect(isQuoteRefreshInCooldown('sahmk')).toBe(true);
    expect(isQuoteRefreshInCooldown('default')).toBe(false);
    expect(quoteRefreshCooldownRemainingMs('sahmk')).toBeGreaterThan(SAHMK_RATE_LIMIT_COOLDOWN_MS - 5_000);
  });

  it('skips network entirely while SAHMK cooldown is active', async () => {
    const { startQuoteRefreshCooldown } = await import('../services/quoteRefreshCooldown');
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk');
    const out = await getSahmkLivePrices(['2222.SR']);
    expect(out).toEqual({});
    expect(fetchSahmkQuote).not.toHaveBeenCalled();
  });

  it('caps distinct SAHMK codes per batch and exposes deferred symbols for requeue', async () => {
    expect(SAHMK_MAX_CODES_PER_BATCH).toBeLessThanOrEqual(8);
    expect(read('services/sahmkQuote.ts')).toContain('SAHMK_MAX_CODES_PER_BATCH');
    expect(read('services/sahmkQuote.ts')).toContain('SAHMK_FETCH_CONCURRENCY');
    expect(read('services/sahmkQuote.ts')).toContain('consumeSahmkBatchDeferredSymbols');
    vi.mocked(fetchSahmkQuote).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ price: 100, previous_close: 99, change: 1, change_percent: 1 }),
    } as Response);
    const syms = Array.from({ length: SAHMK_MAX_CODES_PER_BATCH + 3 }, (_, i) => `${2200 + i}.SR`);
    const pending = getSahmkLivePrices(syms);
    await vi.runAllTimersAsync();
    await pending;
    const deferred = consumeSahmkBatchDeferredSymbols();
    expect(deferred.length).toBe(3);
    expect(deferred).toContain(syms[SAHMK_MAX_CODES_PER_BATCH]!);
    expect(deferred).toContain(syms[SAHMK_MAX_CODES_PER_BATCH + 2]!);
  });

  it('getLivePrices does not throw SAHMK 429 (keeps Finnhub results)', () => {
    const gemini = read('services/geminiService.ts');
    expect(gemini).toContain("startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk')");
    expect(gemini).toContain('serving cache until cooldown ends');
    const trySahmk = gemini.slice(gemini.indexOf('const trySahmk'), gemini.indexOf('const mergeFinnhubStooqAndSahmk'));
    expect(trySahmk).toContain('return {}');
    expect(trySahmk).not.toContain('throw e');
    expect(trySahmk).toContain("isQuoteRefreshInCooldown('sahmk')");
  });

  it('MarketSimulator never bypasses default cooldown for manual forceFetch; requeues SAHMK deferred', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain("const rateLimited = isQuoteRefreshInCooldown('default')");
    expect(sim).toContain('consumeSahmkBatchDeferredSymbols');
    expect(sim).not.toContain('!(priceScope.manual === true && forceFetch)');
  });

  it('proxy caches 429 for the long SAHMK cooldown window', () => {
    expect(read('netlify/functions/sahmk-proxy.ts')).toContain('10 * 60 * 1000');
  });
});
