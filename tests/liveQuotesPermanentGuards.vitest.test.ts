/**
 * Live quotes — permanent E2E guards (cooldown drain, timeout, timestamps, status parity).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  subscribeQuoteRefreshCooldownEnd,
  startQuoteRefreshCooldown,
  resetQuoteRefreshCooldownListenersForTests,
} from '../services/quoteRefreshCooldown';
import { liveFetchTimeoutMs } from '../services/quoteLiveFetchCoordinator';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('live quotes permanent E2E guards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetQuoteRefreshCooldownListenersForTests();
    startQuoteRefreshCooldown(0);
    vi.setSystemTime(new Date('2026-06-18T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetQuoteRefreshCooldownListenersForTests();
  });

  it('cooldown end notifies all subscribers (UI + MarketSimulator drain)', () => {
    const drain = vi.fn();
    const ui = vi.fn();
    subscribeQuoteRefreshCooldownEnd(drain);
    const unsubUi = subscribeQuoteRefreshCooldownEnd(ui);
    startQuoteRefreshCooldown(5_000);
    vi.advanceTimersByTime(5_500);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(ui).toHaveBeenCalledTimes(1);
    unsubUi();
    startQuoteRefreshCooldown(5_000);
    vi.advanceTimersByTime(5_500);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(ui).toHaveBeenCalledTimes(1);
  });

  it('live fetch timeout scales with Finnhub per-symbol gap', () => {
    expect(liveFetchTimeoutMs(25)).toBeGreaterThanOrEqual(25 * 1100);
    expect(liveFetchTimeoutMs(1)).toBeGreaterThanOrEqual(25_000);
  });

  it('MarketSimulator uses subscribeQuoteRefreshCooldownEnd (not single-slot setter)', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('subscribeQuoteRefreshCooldownEnd');
    expect(sim).not.toContain('setQuoteRefreshCooldownEndListener');
  });

  it('useQuoteRefreshCooldownMs uses additive subscription', () => {
    const hook = read('hooks/useQuoteRefreshCooldown.ts');
    expect(hook).toContain('subscribeQuoteRefreshCooldownEnd');
    expect(hook).not.toContain('setQuoteRefreshCooldownEndListener(null)');
  });

  it('cache-only ticks do not stamp quotes as now', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('applyQuoteTimestamps');
    expect(sim).toContain('networkFetchedThisTick');
    expect(sim).toContain('mergeSymbolQuoteTimestamps');
    expect(sim).not.toMatch(/touchQuoteTimestamps\(Object\.keys\(rows\)\)/);
  });

  it('lastUpdated only bumps on network fetch for global refresh', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('applyGlobalLastUpdated');
    expect(sim).toMatch(/if \(networkFetchedThisTick\)[\s\S]{0,80}setLastUpdated\(new Date\(\)\)/);
  });

  it('late equity fetch syncs session via quote cache bridge', () => {
    expect(read('services/quoteLiveFetchCoordinator.ts')).toContain('syncQuoteCacheToSessionNow');
    expect(read('context/MarketDataContext.tsx')).toContain('registerQuoteCacheSessionSync');
  });

  it('tracked symbols include personalInvestments scope', () => {
    expect(read('services/cachedQuoteRestore.ts')).toContain('getPersonalInvestments');
    expect(read('services/netWorthSnapshotReadiness.ts')).toContain('collectTrackedQuoteSymbols');
  });

  it('Header mobile + QuotesAsOfBadge use quotesPriceSource', () => {
    expect(read('components/Header.tsx')).toContain("quotesPriceSource === 'cached'");
    expect(read('components/analytics/QuotesAsOfBadge.tsx')).toContain('quotesPriceSource');
    expect(read('components/analytics/QuotesAsOfBadge.tsx')).not.toContain('!isLive');
  });

  it('stale bootstrap includes watchlist symbols', () => {
    expect(read('components/MarketSimulator.tsx')).toContain('watchSymbols');
  });

  it('pending overflow survives cooldown without premature finishQuotesRefresh', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toMatch(/pendingSymbols && after[\s\S]{0,400}bumpPriceRefresh/);
    expect(sim).not.toMatch(/pendingSymbols && after[\s\S]{0,120}finishQuotesRefresh\(\)/);
  });
});
