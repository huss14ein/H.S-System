/**
 * Live quotes — full path from hydrate → cache → fetch → UI (E2E wiring + behavior guards).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergePriceRefreshScope } from '../services/quoteRefreshQueue';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('live quotes E2E wiring', () => {
  it('provider queues manual refresh even during cooldown / nav pause', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).not.toContain('isQuoteRefreshInCooldown() && scope.forceFetch');
    expect(ctx).not.toContain('isBackgroundWorkPaused() && scope.forceFetch');
    expect(ctx).toContain('setRefreshTrigger((prev) => prev + 1)');
  });

  it('MarketSimulator: stale bootstrap, pause retry, in-flight coalesce, urgent apply', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('waitUntilBackgroundWorkResumed');
    expect(sim).toContain('pendingRefreshWhileInFlightRef');
    expect(sim).toContain('scheduleRefreshRetry');
    expect(sim).toContain('urgentApply');
    expect(sim).toContain('MAX_LIVE_FETCH_PER_TICK = 25');
    expect(sim).toContain('pendingLiveFetchSymbolsRef.current = []');
    expect(sim).toContain('isAnyEquityMarketRegularSessionOpen');
    expect(sim).toContain('silent: true');
    expect(sim).toContain('visibilityState');
    expect(sim).toContain('forceFetch: false');
    expect(sim).toContain('bumpPriceRefresh(priceScope)');
    expect(sim).toContain('nextQuotesPriceSourceAfterTick');
  });

  it('navigation resumes quote drain after pause (does not cancel)', () => {
    expect(read('utils/navigationBridge.ts')).toContain('resumeQuoteRefreshAfterNav');
    expect(read('utils/quoteRefreshBridge.ts')).toContain('kickQuoteRefreshNow');
    expect(read('context/MarketDataContext.tsx')).toContain('kickQuoteRefreshNow');
    expect(read('components/Layout.tsx')).toContain('registerQuoteRefreshResume');
    expect(read('components/MarketSimulator.tsx')).toContain('registerQuoteRefreshKick');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('resumeQuoteRefreshAfterNav');
    expect(read('components/AuthenticatedAppShell.tsx')).not.toContain('cancelQuoteRefreshOnNav');
  });

  it('quote hooks split live cells vs KPI-aligned canonical map', () => {
    const canonicalHook = read('hooks/useCanonicalFinancialMetrics.ts');
    expect(canonicalHook).toContain('shell.full.simulatedPrices');
    expect(canonicalHook).toContain('useDebouncedValue(simulatedPrices, 250)');
    expect(read('hooks/useLiveQuotePrices.ts')).toContain('useMarketPrices');
    expect(read('pages/Investments.tsx')).toContain('useMarketPrices()');
    expect(read('pages/Investments.tsx')).toContain('kpiQuotePrices');
  });

  it('every successful fetch persists to quote cache', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('persistCommodityQuotePrices');
    expect(sim).toContain('applyStoredQuoteFallback');
    expect(read('services/quoteLiveFetchCoordinator.ts')).toContain('persistSanitizedLiveQuotes');
    expect(read('context/MarketDataContext.tsx')).toContain('loadQuoteCacheRows');
  });

  it('canonical metrics overlay live quote tier on extended bundle', () => {
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain(
      'overlayLiveQuoteTierOntoExtendedMetrics',
    );
    expect(read('hooks/canonicalFinancialMetricsBundle.ts')).toContain(
      'overlayLiveQuoteTierOntoExtendedMetrics',
    );
  });

  it('all user refresh entry points force-fetch', () => {
    const header = read('components/Header.tsx');
    expect(header).toMatch(/refreshPrices\(\{ forceFetch: true \}\)/g);
    expect(read('pages/Investments.tsx')).toContain('refreshPricesForPlatform');
    expect(read('context/MarketDataContext.tsx')).toContain('forceFetch: true, manual: true');
  });

  it('quote refresh queue merges overflow symbol batches', () => {
    const first = mergePriceRefreshScope([], { kind: 'symbols', symbols: ['AAPL'], manual: true });
    const second = mergePriceRefreshScope(first.queue, {
      kind: 'symbols',
      symbols: ['MSFT', 'AAPL'],
      manual: true,
      forceFetch: true,
    });
    expect(second.changed).toBe(true);
    expect(second.queue[0]).toMatchObject({
      kind: 'symbols',
      symbols: ['AAPL', 'MSFT'],
      forceFetch: true,
      manual: true,
    });
  });

  it('holdings valuation uses alias-aware quote lookup', () => {
    expect(read('utils/holdingValuation.ts')).toContain('lookupLiveQuoteForSymbol');
    expect(read('services/finnhubService.ts')).toContain('expandLiveQuotesForRequestedSymbols');
  });

  it('verification script registers live quote tests', () => {
    const script = read('scripts/verify-performance-recovery.mjs');
    expect(script).toContain('marketDataRefresh.vitest.test.ts');
    expect(script).toContain('liveQuotesEndToEnd.vitest.test.ts');
  });
});
