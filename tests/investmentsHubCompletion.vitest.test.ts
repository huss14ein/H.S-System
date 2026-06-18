/**
 * Investments hub — week/month P/L, live quotes, and performance wiring (E2E guards).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Investments hub completion (E2E)', () => {
  it('period P/L: single engine, scoped cash, ledger seed fix', () => {
    expect(read('services/portfolioPeriodPnL.ts')).toContain('ledgerLotsMatchHoldings');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('ledgerExplainsHoldings');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('singlePortfolioOnAccount');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('buildInvestmentAccountKpiScope');
    expect(read('pages/Investments.tsx')).toContain('platformPeriodPnLFromSummary');
    expect(read('pages/Investments.tsx')).toContain('buildInvestmentAccountKpiScope');
  });

  it('Investments UI shows week/month P/L with ready gate', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('periodPnLReady');
    expect(page).toContain('periodPnLSparklinesReady');
    expect(page).toContain('usePortfolioPeriodPnLSnapshot');
    expect(page).toContain('aria-busy={!periodPnLReady}');
  });

  it('portfolio P/L hook waits for nav pause and marks ready on summary', () => {
    const hook = read('hooks/usePortfolioPeriodPnLSnapshot.ts');
    expect(hook).toContain('waitUntilBackgroundWorkResumed');
    expect(hook).toContain('sparklinesReady');
    expect(hook).toMatch(/ready:\s*true,\s*\n\s*sparklinesReady:\s*false/);
  });

  it('daily P/L zeros outside regular session via currencyMath helper', () => {
    expect(read('utils/currencyMath.ts')).toContain('quoteChangeForDailyPnL');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('quoteDailyPnLInBookCurrency');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('quoteChangeForDailyPnL');
  });

  it('stale quote bootstrap after hydrate', () => {
    expect(read('components/MarketSimulator.tsx')).toContain('didScheduleStaleRefreshRef');
    expect(read('components/MarketSimulator.tsx')).toContain('symbolsNeedingLiveFetch');
  });

  it('live price refresh: manual force queues through cooldown', () => {
    expect(read('context/MarketDataContext.tsx')).not.toContain('finishQuotesRefresh();\n            return;');
    expect(read('components/MarketSimulator.tsx')).toContain('pendingLiveFetchSymbolsRef');
    expect(read('components/Header.tsx')).toContain('Queued for live');
  });

  it('performance: deferred portfolio KPI bundle + memoized platform card', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('scheduleIdleWorkAsync');
    expect(page).toContain('React.memo(PlatformCardInner)');
    expect(page).not.toContain('onClick={() => startTransition(onToggleExpanded)}');
  });

  it('headline KPI row: single source on Investments hub', () => {
    expect(read('pages/Investments.tsx')).toContain('buildInvestmentsHeadlineKpiRow');
    expect(read('services/extendedMetricsPresentation.ts')).toContain('buildInvestmentsHeadlineKpiRow');
  });

  it('verification script registers hub + KPI E2E tests', () => {
    const script = read('scripts/verify-performance-recovery.mjs');
    expect(script).toContain('investmentsHubCompletion.vitest.test.ts');
    expect(script).toContain('investmentsKpiE2E.vitest.test.ts');
    expect(script).toContain('marketDataRefresh.vitest.test.ts');
    expect(script).toContain('portfolioPeriodPnLEndToEnd.vitest.test.ts');
  });
});
