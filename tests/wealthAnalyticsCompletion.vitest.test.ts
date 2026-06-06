/**
 * End-to-end completion guards: Wealth Analytics performance + canonical metrics + section wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Wealth Analytics completion (E2E)', () => {
  it('route: lazy chunk, prefetch priority, shell nav props', () => {
    expect(read('utils/lazyPages.tsx')).toMatch(/'Wealth Analytics':\s*lazyPage/);
    expect(read('utils/lazyPages.tsx')).toContain("PRIORITY_PREFETCH_PAGES");
    expect(read('utils/lazyPages.tsx')).toContain("'Wealth Analytics'");
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain("case 'Wealth Analytics':");
    expect(shell).toContain('prefetchPage');
    expect(read('pages/WealthAnalytics.tsx')).toMatch(/setActivePage\?:/);
  });

  it('canonical metrics: single hook path for headline, KPI, wealth summary, quotes', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('useCanonicalFinancialMetrics');
    expect(page).toContain('wealthSummary: reportModel');
    expect(page).toContain('netWorth');
    expect(page).toContain('liquidCashSar');
    expect(page).toContain('investmentsTotalSar');
    expect(page).toContain('investmentAllocation');
    expect(page).toContain('simulatedPrices');
    expect(page).toContain('sarPerUsd');
    expect(page).not.toContain('resolveSarPerUsd');
    expect(page).not.toContain('useMarketData');
    expect(page).not.toContain('computePersonalNetWorth');
    expect(page).not.toContain('computeDashboardKpiSnapshot');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain(
      'useDebouncedValue(showHydrateBanner ? null : data, 350)',
    );
  });

  it('wealth scope: personal accounts, investments, transactions', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('getPersonalTransactions');
    expect(page).toContain('getPersonalAccounts');
    expect(page).toContain('getPersonalInvestments');
    expect(page).not.toMatch(/personalTransactions\s*\?\?\s*data\?\.transactions/);
    expect(page).not.toMatch(/data\?\.accounts\s*\?\?/);
  });

  it('performance: lazy sections, staggered deferred mount, idle portfolio P/L + sparklines', () => {
    const page = read('pages/WealthAnalytics.tsx');
    const deferred = read('components/analytics/WealthAnalyticsDeferredSections.tsx');
    expect(page).toContain('wealthAnalyticsLazySections');
    expect(page).toContain('SectionLoadingPlaceholder');
    expect(page).toContain('extendedReady');
    expect(deferred).toContain('hideWeeklyPnL');
    expect(page).not.toContain('usePortfolioPeriodPnLSnapshot');
    expect(deferred).toContain('useExecutiveKpiSparklines');
    expect(page).not.toContain('Loading analytics');
    expect(page).not.toContain('Preparing analytics');
    expect(read('components/dashboard/DeferredMount.tsx')).toContain('scheduleIdleWork');
    expect(read('components/dashboard/DeferredMount.tsx')).toContain('staggerIndex');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useExecutiveKpiSparklines.ts')).toContain('scheduleIdleWorkAsync');
    const lazy = read('components/analytics/wealthAnalyticsLazySections.tsx');
    expect(lazy).toContain('LazyPortfolioPeriodPnLPanel');
    expect(lazy).toContain('LazySummaryWealthAtlas');
    expect(lazy).toContain('LazyDashboardOperationsCockpit');
    expect(lazy).toContain('LazyWealthAnalyticsDetailsSection');
  });

  it('portfolio P/L panel skips duplicate sync compute when precomputed', () => {
    const panel = read('components/dashboard/PortfolioPeriodPnLPanel.tsx');
    expect(panel).toContain('precomputed?:');
    expect(panel).toContain('usePortfolioPeriodPnLSnapshot');
    expect(panel).toMatch(/data:\s*precomputed\s*\?\s*null\s*:\s*data/);
    expect(panel).toContain('loading');
    const hook = read('hooks/usePortfolioPeriodPnLSnapshot.ts');
    expect(hook).toContain('computePortfolioPeriodPnLSummaryAsync');
    expect(hook).toContain('computePortfolioPnLDailySeriesAsync');
    expect(hook).toContain('yieldToMain');
    expect(hook).toContain('weeklySparkline: dailySeries.weekly.map');
  });

  it('details section: lazy chunk, deferred insights, canonical FX for enhancement engines', () => {
    const details = read('components/analytics/WealthAnalyticsDetailsSection.tsx');
    expect(details).toContain('useWealthAnalyticsDeferredInsights');
    expect(details).toContain('useFinancialEnhancementInsights');
    expect(details).toContain('exchangeRate: sarPerUsd');
    expect(details).toContain('WealthAnalyticsSummaryPanelsSection');
    expect(details).toContain('AIExecutiveSummarySection');
    expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('reconcileDashboardVsSummaryKpis');
    expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('kpiSnapshot.netWorth');
    expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('reportModel.financialMetricsWithEf');
    expect(read('pages/WealthAnalytics.tsx')).toContain('WealthAnalyticsDetailsSectionLazy');
    expect(read('pages/WealthAnalytics.tsx')).toContain('defaultExpanded={false}');
  });

  it('export menu: canonical headline, KPI, wealth summary payload', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('WealthAnalyticsExportMenuSection');
    expect(page).toContain('wealthSummaryPayload={reportModel.wealthSummaryReportPayload}');
    expect(page).toContain('headline={headline}');
    expect(page).toContain('kpiSnapshot={kpiSnapshot}');
    const menu = read('components/analytics/WealthAnalyticsExportMenu.tsx');
    expect(menu).toContain('buildWealthAnalyticsReportModel');
    expect(menu).toContain('generateWealthExecutiveSummaryHtml');
    expect(menu).toContain('useEmergencyFund');
  });

  it('holdings grid: portfolio filter wired end-to-end', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('wealth-analytics-portfolio');
    expect(page).toContain('portfolioId={holdingsPortfolioId');
    expect(read('components/dashboard/PortfolioHoldingsGrid.tsx')).toContain('scopedPortfolios');
    expect(read('components/dashboard/CostAveragingCalculator.tsx')).toContain('portfolioId');
  });

  it('health indicators + atlas use canonical report model and allocation slices', () => {
    const page = read('pages/WealthAnalytics.tsx');
    const deferred = read('components/analytics/WealthAnalyticsDeferredSections.tsx');
    expect(page).toContain('discipline={reportModel.discipline}');
    expect(page).toContain('liquidityRunway={reportModel.liquidityRunway}');
    expect(page).toContain('investmentAllocation={investmentAllocation}');
    expect(page).toContain('buckets={headline.buckets}');
    expect(page).toContain('netWorthSar={netWorth');
    expect(deferred).toContain('useEnhancementSignals');
  });

  it('operations cockpit receives canonical liquid cash and investment total', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain('liquidCashSar={liquidCashSar}');
    expect(page).toContain('investmentsTotalSar={extendedReady ? investmentsTotalSar : headline.buckets.investments}');
    expect(page).toContain('sarPerUsd={sarPerUsd}');
  });

  it('Executive KPI grid uses canonical headline + KPI snapshot + deferred NW sparkline', () => {
    const deferred = read('components/analytics/WealthAnalyticsDeferredSections.tsx');
    expect(deferred).toContain('headline={headline}');
    expect(deferred).toContain('kpiSnapshot={kpiSnapshot}');
    expect(deferred).toContain('netWorthSparklineOverride={netWorthSparkline}');
    expect(read('components/analytics/ExecutiveKpiGrid.tsx')).toContain('netWorthSparklineOverride');
  });
});
