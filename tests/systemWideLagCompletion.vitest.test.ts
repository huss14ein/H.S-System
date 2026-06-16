/**
 * End-to-end completion guards for the system-wide lag, alerts, and quality rollout.
 * Traces wiring across services, shell, investment sub-pages, and verification tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const INVESTMENT_SUB_PAGES = [
  'InvestmentOverview.tsx',
  'WatchlistView.tsx',
  'DividendTrackerView.tsx',
  'RecoveryPlanView.tsx',
];

const FINNHUB_NAME_SURFACES = [
  'pages/Investments.tsx',
  'pages/InvestmentOverview.tsx',
  'pages/WatchlistView.tsx',
  'pages/DividendTrackerView.tsx',
  'pages/RecoveryPlanView.tsx',
  'pages/Goals.tsx',
  'pages/Zakat.tsx',
  'pages/LiquidationPlanner.tsx',
  'pages/WealthUltraDashboard.tsx',
  'components/DividendSmsImportPanel.tsx',
  'pages/FinancialJournal.tsx',
];

describe('system-wide lag completion E2E', () => {
  it('alerts read-state: merge, grace, per-row dismiss', () => {
    const ctx = read('context/NotificationsContext.tsx');
    expect(ctx).toMatch(/setReadIds\(\(prev\) => new Set\(\[\.\.\.prev, \.\.\.notifications\.map/);
    expect(ctx).toContain('dismissGraceUntilRef');
    expect(ctx).toContain('inDismissGrace');
    expect(read('components/HeaderAlertsPopover.tsx')).toContain('markAsRead(n.id)');
    expect(read('tests/notificationsReadState.vitest.test.ts')).toContain('markAllAsRead merges');
  });

  it('finnhub: cached profiles, static-first names, skip known holding names', () => {
    expect(read('services/finnhubService.ts')).toContain('getCompanyProfileCached');
    expect(read('hooks/useSymbolCompanyName.ts')).toContain('getStaticCompanyName(key)');
    expect(read('hooks/useSymbolCompanyName.ts')).toContain('FETCH_CONCURRENCY');
    for (const rel of FINNHUB_NAME_SURFACES) {
      const src = read(rel);
      expect(src, rel).toContain('symbolsNeedingCompanyName');
    }
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('platformSymbolNames');
    expect(inv).not.toMatch(/const PlatformCard[\s\S]{0,8000}useCompanyNames\(/);
  });

  it('finnhub fundamentals are lazy on Watchlist and Dividend Tracker', () => {
    const wl = read('pages/WatchlistView.tsx');
    expect(wl).toContain('requestFundamentalsForSymbol');
    expect(wl).toContain('onRequestFundamentals');
    expect(wl).not.toMatch(/Promise\.all\([\s\S]{0,200}getHoldingFundamentals/);
    const div = read('pages/DividendTrackerView.tsx');
    expect(div).toContain('fundamentalsSymbolsNeedingMarket');
    expect(div).toContain('scheduleIdleWork');
    expect(div).not.toMatch(/for \(const sym of fundamentalsSymbols\)/);
  });

  it('FX map memory cache and KPI preload', () => {
    expect(read('services/fxDailySeries.ts')).toContain('fxMapMemoryCache');
    expect(read('services/fxDailySeries.ts')).toContain('lastHydrateFingerprint');
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('fxMapForKpiCompute');
    expect(read('services/dashboardKpiSnapshot.ts')).toMatch(/getSarPerUsdForCalendarDay\([^)]+fxMap/);
    expect(read('tests/fxMapMemoryCache.vitest.test.ts')).toBeTruthy();
  });

  it('single navigation path with hash suppression', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('suppressNextHashChangeRef');
    expect(shell).toContain('cancelQuoteRefreshOnNav');
    expect(shell).toContain('prefetchPage(page)');
    expect(shell).toContain('NAV_TRANSITION_PAUSE_MS');
    expect(read('utils/navigationBridge.ts')).toContain('registerQuoteRefreshCancel');
    expect(read('components/Layout.tsx')).not.toContain('navigatePage = useCallback');
    expect(read('hooks/useBackgroundWorkInputPause.ts')).toContain('data-nav-link');
    expect(read('components/Header.tsx')).toContain('data-nav-link');
  });

  it('canonical metrics stale-while-revalidate extended bundle', () => {
    const ctx = read('context/CanonicalFinancialMetricsContext.tsx');
    expect(ctx).toContain('extendedBundle ?? fastBundle');
    expect(ctx).toContain('financialDataHasHydrated(data)');
    expect(ctx).toContain('useDeferredValue(debouncedPrices)');
    expect(ctx).toMatch(
      /}, \[extendedFingerprint, metricsData, exchangeRate, getAvailableCashForAccount, deferredPrices\]\)/,
    );
    expect(ctx).not.toMatch(/\[extendedFingerprint[\s\S]{0,120}fastBundle/);
    expect(read('pages/Dashboard.tsx')).toContain('kpisPending');
    expect(read('pages/Dashboard.tsx')).toContain('SectionLoadingPlaceholder');
  });

  it('wealth pages use canonical metrics hooks (not ad-hoc headline FX)', () => {
    const exempt = new Set([
      'LoginPage.tsx',
      'SignupPage.tsx',
      'PendingApprovalPage.tsx',
      'SystemHealth.tsx',
      'Installments.tsx',
      'StatementHistoryView.tsx',
      'ExecutionHistoryView.tsx',
      'FinancialJournal.tsx',
      'SinkingFunds.tsx',
      'Notifications.tsx',
      'Cashflow.tsx',
      'Platforms.tsx',
      'TransactionsPage.tsx',
    ]);
    const missing: string[] = [];
    for (const file of readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.tsx'))) {
      if (exempt.has(file)) continue;
      const src = read(`pages/${file}`);
      const usesCanonical =
        src.includes('useCanonicalFinancialMetrics') ||
        src.includes('useDashboardCanonicalMetrics') ||
        src.includes('useInvestmentsCanonicalMetrics') ||
        src.includes('useCanonicalSpotFx') ||
        src.includes('useEmergencyFund');
      if (!usesCanonical) missing.push(file);
    }
    expect(missing, `Add canonical metrics hook to: ${missing.join(', ')}`).toEqual([]);
  });

  it('investment sub-tabs wire extended metrics and avoid per-card name storms', () => {
    for (const file of INVESTMENT_SUB_PAGES) {
      const src = read(`pages/${file}`);
      expect(src, file).toMatch(/useExtendedCanonicalMetrics|useInvestmentsCanonicalMetrics|useCanonicalSpotFx/);
    }
    expect(read('pages/Investments.tsx')).toContain('<InvestmentsMetricsProvider>');
    expect(read('context/InvestmentsMetricsContext.tsx')).toContain('useExtendedCanonicalMetrics');
  });

  it('idle prefetch warms one route per slice (no parallel priority storm)', () => {
    const lazy = read('utils/lazyPages.tsx');
    expect(lazy).toContain('scheduleIdleWork(step, 1500)');
    expect(lazy).not.toMatch(/for \(const page of PRIORITY_PREFETCH_PAGES\)[\s\S]{0,80}prefetchPage/);
  });

  it('Forecast uses extended investment baseline and loading gate', () => {
    const src = read('pages/Forecast.tsx');
    expect(src).toContain('useExtendedCanonicalMetrics');
    expect(src).toContain('pickInvestmentsTotalSar');
    expect(src).toContain('SectionLoadingPlaceholder');
  });

  it('partial wealth pages gate extended investment fields', () => {
    for (const file of ['pages/Accounts.tsx', 'pages/Analysis.tsx', 'pages/Settings.tsx', 'pages/WealthUltraDashboard.tsx']) {
      const src = read(file);
      expect(src, file).toContain('ExtendedMetricGate');
      expect(src, file).toMatch(/ready=\{extendedReady\}/);
    }
  });

  it('fundamentals API uses service-level cache', () => {
    expect(read('services/finnhubService.ts')).toContain('getHoldingFundamentalsCached');
  });

  it('verification tests and scripts are registered', () => {
    const script = read('scripts/verify-performance-recovery.mjs');
    expect(script).toContain('systemWideLagCompletion.vitest.test.ts');
    expect(script).toContain('notificationsReadState.vitest.test.ts');
    expect(script).toContain('finnhubProfileCache.vitest.test.ts');
    expect(script).toContain('extendedMetricsE2eWiring.vitest.test.ts');
  });
});
