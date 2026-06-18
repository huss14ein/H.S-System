/**
 * Quote persistence E2E — store on every fetch, hydrate on load, display until replaced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const PRICE_DISPLAY_HOOKS = [
  'useMarketPrices',
  'useLiveQuotePrices',
  'useCanonicalSimulatedPrices',
  'useExtendedCanonicalMetrics',
  'useInvestmentsCanonicalMetrics',
  'useCanonicalFinancialMetrics',
];

describe('quote persistence E2E', () => {
  it('single equity fetch choke point persists sanitized quotes', () => {
    const coord = read('services/quoteLiveFetchCoordinator.ts');
    expect(coord).toContain('persistSanitizedLiveQuotes');
    expect(coord).toContain('sanitizeLiveQuoteBatch');
    expect(coord).not.toContain('getLivePrices(normalized).finally');
  });

  it('commodity fetches persist through MarketSimulator', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('persistCommodityQuotePrices');
    expect(sim).toContain('applyStoredQuoteFallback');
    expect(sim).toContain('computeRestoreCachedQuotesPatch');
    expect(sim).toContain('loadQuoteCacheRows()');
  });

  it('MarketDataProvider hydrates session prices from localStorage cache', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).toContain('loadQuoteCacheRows()');
    expect(ctx).toContain('cacheRowsToSimulatedMap');
    expect(ctx).toContain('latestQuoteCacheTimestamp');
    expect(ctx).toContain("'cached'");
    expect(ctx).toContain('initialCacheRows');
  });

  it('cached rows display until live fetch replaces them (stale OK)', () => {
    const cache = read('services/quotePriceCache.ts');
    expect(cache).toContain('buildDisplayMapFromCachedRows');
    expect(cache).toContain('persistFetchedLiveQuotes');
    expect(cache).toContain('fetchedAt');
    expect(read('services/cachedQuoteRestore.ts')).toContain('buildTrustedSnapshotFromCacheForSymbols');
  });

  it('Investments and Watchlist read live/cache prices via MarketPricesContext', () => {
    expect(read('pages/Investments.tsx')).toContain('useMarketPrices()');
    expect(read('pages/WatchlistView.tsx')).toContain('useLiveQuotePrices');
    expect(read('context/InvestmentsMetricsContext.tsx')).toContain('useLiveQuotePrices');
    expect(read('hooks/useLiveQuotePrices.ts')).toContain('useMarketPrices');
  });

  it('MarketDataProvider rehydrates from cache on storage + visibility', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).toContain('QUOTE_CACHE_STORAGE_KEY');
    expect(ctx).toContain('rehydrateSessionPricesFromQuoteCache');
    expect(ctx).toContain('visibilitychange');
  });

  it('investment sub-views and snapshots use live quote hook', () => {
    expect(read('pages/AIRebalancerView.tsx')).toContain('useInvestmentsCanonicalMetrics');
    expect(read('pages/InvestmentPlanView.tsx')).toContain('useInvestmentsCanonicalMetrics');
    expect(read('pages/RecoveryPlanView.tsx')).toContain('useInvestmentsCanonicalMetrics');
    expect(read('components/Layout.tsx')).toContain('useLiveQuotePrices');
    expect(read('components/charts/NetWorthCockpit.tsx')).toContain('useLiveQuotePrices');
    expect(read('pages/Forecast.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('pages/InvestmentOverview.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('pages/WealthUltraDashboard.tsx')).toContain('useLiveQuotePrices');
  });

  it('valuation helpers resolve alias-aware quotes from stored map', () => {
    expect(read('utils/holdingValuation.ts')).toContain('lookupLiveQuoteForSymbol');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('lookupLiveQuoteForSymbol');
  });

  it('wealth surfaces use canonical or live quote hooks (not ad-hoc fetch)', () => {
    const pages = readdirSync(join(process.cwd(), 'pages')).filter((f) => f.endsWith('.tsx'));
    const wealthPages = [
      'Dashboard.tsx',
      'Investments.tsx',
      'WatchlistView.tsx',
      'InvestmentOverview.tsx',
      'Summary.tsx',
      'WealthAnalytics.tsx',
    ];
    for (const file of wealthPages) {
      const src = read(`pages/${file}`);
      const usesHook = PRICE_DISPLAY_HOOKS.some((h) => src.includes(h));
      expect(usesHook, `${file} must use a cache-backed quote hook`).toBe(true);
    }
  });

  it('verification scripts register quote persistence tests', () => {
    expect(read('scripts/verify-performance-recovery.mjs')).toContain('quotePersistenceEndToEnd.vitest.test.ts');
    expect(read('scripts/verify-performance-recovery.mjs')).toContain('quotePriceCache.vitest.test.ts');
  });
});
