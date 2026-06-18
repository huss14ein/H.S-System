/**
 * Quote session status — E2E wiring from cache bootstrap → header → Investments UI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isQuotesFromLiveApi,
  quoteSourceDisplayLabel,
  shouldPromptForLiveQuoteRefresh,
} from '../services/quoteSessionStatus';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('quote session status E2E', () => {
  it('helpers distinguish live vs cached vs simulated', () => {
    expect(quoteSourceDisplayLabel('live')).toBe('Live');
    expect(quoteSourceDisplayLabel('cached')).toBe('Cached');
    expect(quoteSourceDisplayLabel('none')).toBe('Simulated');
    expect(isQuotesFromLiveApi('live')).toBe(true);
    expect(isQuotesFromLiveApi('cached')).toBe(false);
    expect(shouldPromptForLiveQuoteRefresh('cached')).toBe(true);
    expect(shouldPromptForLiveQuoteRefresh('live')).toBe(false);
  });

  it('cache bootstrap does not mark session as live API', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).toMatch(/const \[isLive, setIsLive\] = useState\(false\)/);
    expect(ctx).toContain("prev === 'live' ? 'live' : 'cached'");
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('didBootstrapSessionCacheRef');
    expect(sim).toContain('rehydrateSessionPricesFromQuoteCache');
    expect(sim).toContain('networkFetchedThisTick');
    expect(sim).toContain('nextQuotesPriceSourceAfterTick');
    expect(sim).toContain('applySessionQuoteSource');
  });

  it('live session is not demoted on cache-only ticks or tab rehydrate', () => {
    expect(read('services/quoteSessionStatus.ts')).toContain('nextQuotesPriceSourceAfterTick');
    expect(read('components/MarketSimulator.tsx')).not.toContain("setQuotesPriceSource('cached')");
    expect(read('context/MarketDataContext.tsx')).toContain("prev === 'live' ? 'live' : 'cached'");
  });

  it('cooldown drains pending symbols without manual session gate', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('subscribeQuoteRefreshCooldownEnd');
    expect(sim).not.toMatch(/if \(!isManual\(\)\) return;\s*\n\s*const pending = pendingLiveFetchSymbolsRef/);
  });

  it('Investments + LivePricesStatus use quotesPriceSource (same as header)', () => {
    expect(read('components/LivePricesStatus.tsx')).toContain('quotesPriceSource');
    expect(read('components/LivePricesStatus.tsx')).toContain('quoteSourceDisplayLabel');
    expect(read('components/investments/InvestmentsQuoteStatusBanner.tsx')).toContain('quotesPriceSource');
    expect(read('components/investments/InvestmentsQuoteStatusBanner.tsx')).toContain('useQuoteRefreshCooldownMs');
    expect(read('pages/Investments.tsx')).toContain('quotesPriceSource={quotesPriceSource}');
    expect(read('components/Header.tsx')).toContain('quotesPriceSource');
  });

  it('Investments KPI row gates ROI on headlineKpisReady', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('headlineKpisReady');
    expect(page).toContain('title="Portfolio ROI"');
    expect(page).toMatch(/title="Portfolio ROI"[\s\S]{0,400}headlineKpisReady/);
  });

  it('canonical metrics compute once financial data has hydrated', () => {
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('financialDataHasHydrated(data)');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).not.toContain(
      'showHydrateBanner && !financialDataHasHydrated',
    );
  });
});
