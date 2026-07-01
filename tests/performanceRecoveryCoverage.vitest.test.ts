/**
 * End-to-end wiring guards for the performance recovery rollout (2.1.1.0).
 * Complements manual preview checks in docs/PERFORMANCE_RECOVERY_E2E.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('performance recovery E2E wiring', () => {
  it('StatementProcessingContext does not upsert on hydrate-only effects', () => {
    const src = read('context/StatementProcessingContext.tsx');
    expect(src).toContain('statementsHydratedRef');
    expect(src).toContain('STATEMENT_LIST_SELECT');
    expect(src).toContain('loadStatementDetail');
    expect(src).toContain('shouldPersistStatementsAfterHydrate');
    expect(src).toMatch(/Debounced localStorage backup only \(no Supabase upsert/);
    const hydrateBlock = src.slice(src.indexOf('// Load statements from database'), src.indexOf('const uploadStatement'));
    expect(hydrateBlock).not.toMatch(/\.upsert\(/);
    expect(hydrateBlock).not.toMatch(/\.insert\(/);
  });

  it('DataContext uses stable action bindings and hydrate banner (not blocking loader)', () => {
    const src = read('context/DataContext.tsx');
    expect(src).toContain('bindStableActions');
    expect(src).toMatch(/showBlockingLoader\s*=\s*false/);
    expect(src).toContain('showHydrateBanner');
  });

  it('Dashboard and Summary pass NetWorthCockpit metricsOverride', () => {
    expect(read('pages/Dashboard.tsx')).toContain('metricsOverride={{');
    expect(read('pages/Summary.tsx')).toContain('metricsOverride={{');
    expect(read('components/charts/NetWorthCockpit.tsx')).toContain('buildNetWorthTrendSeriesFromSnapshots');
  });

  it('auto NW snapshot waits for quote readiness on Dashboard, Summary, and Layout', () => {
    expect(read('pages/Dashboard.tsx')).toContain('tryAutoCaptureNetWorthSnapshot');
    expect(read('pages/Dashboard.tsx')).toContain('useExtendedMetricsReady');
    expect(read('pages/Summary.tsx')).toContain('tryAutoCaptureNetWorthSnapshot');
    expect(read('pages/Summary.tsx')).toContain('captureNetWorthSnapshotFromHeadline');
    expect(read('components/Layout.tsx')).toContain('canAutoCaptureNetWorthSnapshot');
    expect(read('services/scheduledNetWorthSnapshot.ts')).toContain('snapshotReadiness');
    expect(read('services/netWorthSnapshotReadiness.ts')).toContain('metricsExtendedReady');
    expect(read('services/netWorthSnapshotCapture.ts')).toContain('captureNetWorthSnapshotFromHeadline');
  });

  it('auto NW snapshot throttle is centralized in netWorthSnapshotCapture', () => {
    expect(read('services/netWorthSnapshotCapture.ts')).toContain('shouldThrottleAutoNetWorthSnapshot');
    expect(read('services/netWorthSnapshotThrottle.ts')).toContain('MATERIAL_NW_CHANGE_PCT');
  });

  it('idle route prefetch is registered from the authenticated shell', () => {
    const lazy = read('utils/lazyPages.tsx');
    expect(lazy).toContain('prefetchCommonPagesIdle');
    expect(lazy).toContain('scheduleIdleWork');
    expect(lazy).toMatch(/'Budgets'/);
    expect(lazy).toMatch(/'Transactions'/);
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('prefetchCommonPagesIdle()');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('scheduleIdleWork');
  });

  it('budget advance-from-next-month is wired through palette, page action, and card CTA', () => {
    expect(read('utils/pageActions.ts')).toMatch(/budgets-advance-from-next-month/);
    expect(read('components/CommandPalette.tsx')).toContain('Borrow from next month');
    expect(read('pages/Budgets.tsx')).toContain('handleBorrowFromNextMonth');
    expect(read('components/BudgetOwnPortfolioCard.tsx')).toContain('onBorrowFromNextMonth');
    expect(read('services/budgetAdvanceFromNextMonth.ts')).toContain('summarizeFinalizedAdvanceTransfers');
  });

  it('month-open assistant is on Budgets', () => {
    expect(read('pages/Budgets.tsx')).toContain('BudgetMonthOpenBanner');
    expect(read('pages/Budgets.tsx')).toContain('buildBudgetMonthOpenHints');
    expect(read('components/BudgetMonthOpenBanner.tsx')).toContain('Month-open checklist');
  });

  it('Investments hub wraps canonical metrics provider', () => {
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('<InvestmentsMetricsProvider>');
    expect(inv).toContain('</InvestmentsMetricsProvider>');
  });

  it('KPI drift telemetry is available on Wealth Analytics (strict reconciliation)', () => {
    expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('reconcileDashboardVsSummaryKpis');
    expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('useWealthAnalyticsDeferredInsights');
    expect(read('services/kpiDriftTelemetry.ts')).toContain('kpi_reconciliation_diagnostics');
  });

  it('holdings outlier audit is exposed in System Health', () => {
    expect(read('pages/SystemHealth.tsx')).toContain('findHoldingsValueOutliers');
    expect(read('services/holdingsOutlierAudit.ts')).toContain('findHoldingsValueOutliers');
  });

  it('admin approved overview uses shared monthly spend windows', () => {
    expect(read('pages/Budgets.tsx')).toContain('computeMonthlySpendWindowsForFinancialKey');
    expect(read('pages/Budgets.tsx')).not.toMatch(
      /adminApprovedOverviewRaw[\s\S]{0,800}new Date\([^,]+,\s*0,\s*1/,
    );
  });

  it('budget cards use pagination when many categories', () => {
    expect(read('pages/Budgets.tsx')).toContain('BUDGET_CARDS_PAGE_SIZE');
    expect(read('pages/Budgets.tsx')).toContain('budgetCardsVisibleCount');
  });

  it('shell canonical metrics provider dedupes compute app-wide', () => {
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('CanonicalFinancialMetricsProvider');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('buildFastCanonicalFinancialMetricsResult');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('extendCanonicalFinancialMetricsAsync');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('pickDashboardCanonicalMetrics');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).not.toContain('computeDashboardCanonicalMetrics');
    expect(read('hooks/useCanonicalFinancialMetrics.ts')).toContain('useCanonicalFinancialMetricsContext');
    expect(read('hooks/useCanonicalFinancialMetrics.ts')).toContain('useCanonicalSimulatedPrices');
  });

  it('MarketSimulator restores cache then one-shot stale live refresh', () => {
    const src = read('components/MarketSimulator.tsx');
    expect(src).toContain('computeRestoreCachedQuotesPatch');
    expect(src).toContain('didBootstrapSessionCacheRef');
    expect(src).toContain('didAlignHoldingsFromCacheRef');
    expect(src).toContain('didScheduleStaleRefreshRef');
    expect(src).toContain('symbolsNeedingLiveFetch');
    expect(src).not.toMatch(/didInitialPricePassRef/);
    expect(src).not.toMatch(/bumpPriceRefresh\(\s*\)/);
  });

  it('MarketDataContext queues manual refresh without cooldown/pause gate', () => {
    const src = read('context/MarketDataContext.tsx');
    expect(src).toContain('manualRefreshSessionRef');
    expect(src).toContain('scope.manual !== true');
    expect(src).not.toContain('isQuoteRefreshInCooldown() && scope.forceFetch');
    expect(src).not.toContain('isBackgroundWorkPaused() && scope.forceFetch');
  });

  it('Header refresh always force-fetches on user click (desktop + mobile)', () => {
    const header = read('components/Header.tsx');
    expect(header).toMatch(/refreshPrices\(\{ forceFetch: true \}\)/g);
    expect(header).not.toMatch(/disabled=\{headerRefreshing \|\| quoteCooldownSec/);
    expect(header).toContain('quotesPriceSource');
  });

  it('cachedQuoteRestore service restores holdings without network', () => {
    expect(read('services/cachedQuoteRestore.ts')).toContain('computeRestoreCachedQuotesPatch');
    expect(read('services/cachedQuoteRestore.ts')).toContain('symbolTimestampsFromCacheRows');
    expect(read('tests/cachedQuoteRestore.vitest.test.ts')).toContain('rehydrateSessionPricesFromQuoteCache');
  });

  it('MarketDataContext exposes cached vs live quote source for header', () => {
    expect(read('context/MarketDataContext.tsx')).toContain('QuotesPriceSource');
    expect(read('context/MarketDataContext.tsx')).toContain("Object.keys(initialCacheRows).length > 0 ? 'cached' : 'none'");
  });

  it('ExchangeRateSync skips sub-epsilon FX churn', () => {
    expect(read('components/ExchangeRateSync.tsx')).toMatch(/1e-6/);
  });

  it('Notifications split core vs price-triggered memos', () => {
    const src = read('context/NotificationsContext.tsx');
    expect(src).toContain('coreNotifications');
    expect(src).toContain('priceTriggeredPlanNotifications');
    expect(src).toContain('debouncedPrices');
  });

  it('investment ROI is sanitized for absurd values', () => {
    expect(read('services/investmentKpiCore.ts')).toContain('sanitizeInvestmentRoiDecimal');
  });

  it('FX daily series hydrate dedupes by dataResetKey', () => {
    expect(read('hooks/useHydrateSarPerUsdDailySeries.ts')).toContain('dataResetKey');
  });

  it('heavy hubs use dashboard canonical metrics not full bundle', () => {
    for (const file of ['LogicEnginesHub.tsx', 'EnginesAndToolsHub.tsx', 'RiskTradingHub.tsx']) {
      const src = read(`pages/${file}`);
      expect(src).toContain('useDashboardCanonicalMetrics');
    }
  });

  it('Forecast uses extended metrics for investment baseline', () => {
    const src = read('pages/Forecast.tsx');
    expect(src).toContain('useExtendedCanonicalMetrics');
    expect(src).toContain('pickInvestmentsTotalSar');
  });

  it('stability rollout: shared budget RPC migration fixes date trim', () => {
    const sql = read('supabase/migrations/20260527120000_fix_shared_budget_consumed_date_trim.sql');
    expect(sql).toContain('get_shared_budget_consumed_for_me');
    expect(sql).toMatch(/t\.date::date/);
    expect(sql).not.toMatch(/trim\(t\.date\)/);
  });

  it('stability rollout: quotes, budgets fingerprint, plan drill-down, goal envelope', () => {
    expect(read('services/quoteRefreshCooldown.ts')).toContain('startQuoteRefreshCooldown');
    expect(read('components/MarketSimulator.tsx')).toContain('startQuoteRefreshCooldown');
    expect(read('components/Header.tsx')).toContain('quoteRefreshCooldownRemainingMs');
    expect(read('components/Layout.tsx')).toContain('registerQuoteRefreshResume');
    expect(read('pages/Budgets.tsx')).toContain('buildBudgetSpendFingerprint');
    expect(read('pages/Budgets.tsx')).toContain('sharedRpcBackoffUntilRef');
    expect(read('utils/pageActions.ts')).toMatch(/filter-plan-expense/);
    expect(read('pages/Transactions.tsx')).toContain('filter-plan-expense:');
    expect(read('services/goalProjectionFunding.ts')).toMatch(
      /assignedBudgetMonthly > 0 \? assignedBudgetMonthly : assignedInvestmentMonthly/,
    );
    expect(read('pages/Investments.tsx')).toContain("unrealizedPnLBasis: 'net_capital'");
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toMatch(/useDebouncedValue\(simulatedPrices,\s*250\)/);
    expect(read('services/monthlyInvestmentPlanProgress.ts')).toContain('aggregateMonthlyBudgetAcrossPortfolios');
    expect(read('components/Header.tsx')).toContain('computeMonthlyInvestmentPlanProgress');
    expect(read('pages/Budgets.tsx')).toContain('BudgetSharedRpcBanner');
    expect(read('pages/Budgets.tsx')).toContain('BudgetSharedRpcStatusLine');
    expect(read('services/planExpenseOutliers.ts')).toContain('detectPlanExpenseOutliers');
    expect(read('pages/Plan.tsx')).toContain('PlanExpenseSpikePanel');
    expect(read('pages/Investments.tsx')).toContain('InvestmentsQuoteStatusBanner');
    expect(read('utils/holdingValuation.ts')).toContain('clampStoredMarketValue');
    expect(read('pages/Goals.tsx')).toContain('GoalsFundingEnvelopeBanner');
    expect(read('services/sharedBudgetConsumedRpc.ts')).toContain('fetchSharedConsumedMapOnce');
    expect(read('netlify/functions/sahmk-proxy.ts')).toContain('quoteEdgeCache');
    expect(read('pages/Budgets.tsx')).toContain('setHouseholdEngineReady(true)');
    expect(read('pages/Budgets.tsx')).toContain('Expand to load year projection');
    expect(read('pages/Plan.tsx')).toContain('Compare on Dashboard');
    expect(read('pages/Plan.tsx')).toContain('How planned columns work in the grid');
    expect(read('pages/Plan.tsx')).toContain('savePlanDashboardCompareContext');
    expect(read('pages/Plan.tsx')).toContain("triggerPageAction('Dashboard', 'plan-compare-dashboard')");
    expect(read('pages/Dashboard.tsx')).toContain('PlanCompareContextBanner');
    expect(read('pages/Dashboard.tsx')).toContain('dashboard-kpi-row');
    expect(read('utils/pageActions.ts')).toContain('plan-compare-dashboard');
    expect(read('context/NotificationsContext.tsx')).toContain('priceTriggeredPlanNotifications');
    expect(read('components/MarketSimulator.tsx')).toContain('pendingLiveFetchSymbolsRef');
    expect(read('components/MarketSimulator.tsx')).toContain("kind: 'symbols'");
    expect(read('components/MarketSimulator.tsx')).toContain('getLivePricesDeduped');
    expect(read('context/MarketDataContext.tsx')).toContain('mergePriceRefreshScope');
    expect(read('services/quoteRefreshQueue.ts')).toContain('mergePriceRefreshScope');
    expect(read('services/sahmkQuote.ts')).toContain('codeToDisplaySymbols');
  });

  it('system performance: idle enhancement insights, debounced quotes, expanded prefetch', () => {
    expect(read('hooks/useFinancialEnhancementInsights.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useFinancialEnhancementInsights.ts')).toContain('yieldToMain');
    expect(read('hooks/useWealthAnalyticsDeferredInsights.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useFinancialEnginesIntegration.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useEnhancementSignals.ts')).toMatch(/showHydrateBanner/);
    expect(read('hooks/useDebouncedMarketPrices.ts')).toContain('MarketDebouncedPricesContext');
    expect(read('components/Layout.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('pages/Summary.tsx')).not.toContain('useMarketData');
    expect(read('pages/Investments.tsx')).toContain('useMarketPrices()');
    expect(read('pages/Dashboard.tsx')).toContain('useDashboardCanonicalMetrics');
    expect(read('pages/Dashboard.tsx')).toContain('kpisPending');
    expect(read('pages/Dashboard.tsx')).toContain('SectionLoadingPlaceholder');
    expect(read('pages/Forecast.tsx')).not.toMatch(/useMarketData\(\)[\s\S]{0,120}simulatedPrices/);
    expect(read('pages/Analysis.tsx')).not.toMatch(/useMemo\([\s\S]*hydrateSarPerUsdDailySeries/);
    expect(read('components/HoldingSymbolSelect.tsx')).not.toContain('<select');
    expect(read('pages/Transactions.tsx')).toContain('TRANSACTIONS_LIST_PAGE_SIZE');
    expect(read('context/DataContext.tsx')).toContain('startTransition(() => {');
    expect(read('context/DataContext.tsx')).toContain('pauseBackgroundWork');
    expect(read('context/DataContext.tsx')).not.toContain('continuing with partial workspace');
    expect(read('context/DataContext.tsx')).toContain('transactions: [normalized, ...prev.transactions]');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toMatch(
      /const metricsData = data && financialDataHasHydrated\(data\) \? data : null/,
    );
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).not.toContain('useDebouncedValue(showHydrateBanner ? null : data');
    expect(read('utils/backgroundWorkGate.ts')).toContain('pauseBackgroundWork');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('pauseBackgroundWork');
    expect(read('components/Layout.tsx')).toContain('useBackgroundWorkInputPause');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('startTransition');
    expect(read('components/Layout.tsx')).toContain('useFinancialEnginesIntegration({ eager: false })');
    expect(read('components/MarketSimulator.tsx')).toContain('isBackgroundWorkPaused');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('fastBundle');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('extendCanonicalFinancialMetricsAsync');
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('yieldToMain');
    expect(read('hooks/useEnhancementSignals.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useHydrateSarPerUsdDailySeries.ts')).toContain('scheduleIdleWork');
    expect(read('hooks/useFinancialEnginesIntegration.ts')).toContain('options?.eager === true');
    expect(read('components/Layout.tsx')).toContain('useBackgroundWorkInputPause');
    expect(read('utils/lazyPages.tsx')).toContain("'Analysis'");
    expect(read('context/DataContext.tsx')).toContain('useDeferredValue(data)');
    expect(read('context/DataContext.tsx')).toContain('secondaryFetchPromise');
    expect(read('utils/backgroundWorkGate.ts')).toContain('NAV_TRANSITION_PAUSE_MS');
    expect(read('context/DataContext.tsx')).toContain('yieldToMain');
    expect(read('pages/WealthAnalytics.tsx')).toContain('WealthAnalyticsExecutiveKpiSection');
    expect(read('components/analytics/WealthAnalyticsDeferredSections.tsx')).toContain('hideWeeklyPnL');
    expect(read('pages/WealthAnalytics.tsx')).not.toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('components/analytics/ExecutiveKpiCard.tsx')).toContain('KpiSparklineSvg');
    expect(read('components/analytics/ExecutiveKpiCard.tsx')).not.toContain('recharts');
    expect(read('pages/Transactions.tsx')).toContain('scheduleIdleWork');
    expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('useWealthAnalyticsDeferredInsights');
    expect(read('pages/WealthAnalytics.tsx')).toContain('extendedReady');
    expect(read('pages/WealthAnalytics.tsx')).toContain('wealthAnalyticsLazySections');
    expect(read('components/dashboard/DeferredMount.tsx')).toContain('staggerIndex');
    expect(read('hooks/useExecutiveKpiSparklines.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useExpenseBudgetAnalysisModel.ts')).toContain('scheduleIdleWorkAsync');
    expect(read('hooks/useExpenseBudgetAnalysisModel.ts')).toContain('useDeferredValue');
    expect(read('pages/Analysis.tsx')).toContain('useExpenseBudgetAnalysisModel');
    expect(read('pages/Analysis.tsx')).not.toContain('computeExpenseBudgetAnalysisModel');
    expect(read('components/analysis/ExpenseBudgetAnalysisPanel.tsx')).toContain('scheduleIdleWork');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('computePortfolioPeriodPnLSummaryAsync');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('computePortfolioPnLDailySeriesAsync');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('waitUntilBackgroundWorkResumed');
    expect(read('hooks/usePortfolioPeriodPnLSnapshot.ts')).toContain('sparklinesReady');
    expect(read('utils/yieldToMain.ts')).toContain('setTimeout');
    expect(read('utils/yieldToMain.ts')).toMatch(/window\.setTimeout\(resolve/);
    expect(read('utils/runWhenIdle.ts')).toContain('window.setTimeout(startWork, 0)');
    expect(read('components/MarketSimulator.tsx')).not.toMatch(
      /applyPricesInBackground[\s\S]{0,200}requestIdleCallback/,
    );
    expect(read('services/portfolioPeriodPnL.ts')).toContain('computePortfolioPeriodPnLSummaryAsync');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('cooperativeCheckpoint');
    expect(read('pages/Investments.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('pages/Investments.tsx')).toContain('periodPnLReady');
    expect(read('pages/Investments.tsx')).toContain('buildInvestmentAccountKpiScope');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('buildInvestmentAccountKpiScope');
    expect(read('services/investmentAccountKpiScope.ts')).toContain('deriveLedgerCashBucketsFromInvestmentTransactions');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('resolvePortfolioPeriodPnLEndValueSar');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('utils/runWhenIdle.ts')).toContain('waitUntilBackgroundWorkResumed');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('applyTxToLedgerReplayState');
    expect(read('utils/lazyPages.tsx')).toContain('PRIORITY_PREFETCH_PAGES');
  });

  it('extended metrics: app-wide banner, shared loading shell, and hook gate', () => {
    expect(read('components/Layout.tsx')).toContain('CanonicalMetricsExtendedBanner');
    expect(read('hooks/useCanonicalFinancialMetrics.ts')).toContain('useExtendedCanonicalMetrics');
    expect(read('components/shared/SectionLoadingPlaceholder.tsx')).toContain('aria-live="polite"');
    expect(read('components/dashboard/DeferredMount.tsx')).toContain('SectionLoadingPlaceholder');
    expect(read('pages/Summary.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('pages/InvestmentOverview.tsx')).toContain('extendedReady');
    expect(read('pages/Commodities.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('pages/Assets.tsx')).toContain('ExtendedMetricGate');
    expect(read('pages/Investments.tsx')).toContain('buildInvestmentsHeadlineKpiRow');
    expect(read('context/InvestmentsMetricsContext.tsx')).toContain('useExtendedCanonicalMetrics');
    expect(read('services/extendedMetricsPresentation.ts')).toContain('pickWealthSummary');
  });

  it('finnhub profile cache and static-first company names', () => {
    expect(read('services/finnhubService.ts')).toContain('getCompanyProfileCached');
    expect(read('hooks/useSymbolCompanyName.ts')).toContain('getStaticCompanyName(key)');
    expect(read('hooks/useSymbolCompanyName.ts')).toContain('symbolsNeedingCompanyName');
    expect(read('hooks/useSymbolCompanyName.ts')).toContain('FETCH_CONCURRENCY');
    expect(read('pages/Investments.tsx')).toContain('platformSymbolNames');
    expect(read('pages/WatchlistView.tsx')).toContain('requestFundamentalsForSymbol');
    expect(read('pages/WatchlistView.tsx')).not.toMatch(/Promise\.all\([\s\S]{0,120}getHoldingFundamentals/);
  });

  it('FX map memory cache and KPI preload wiring', () => {
    expect(read('services/fxDailySeries.ts')).toContain('fxMapMemoryCache');
    expect(read('services/dashboardKpiSnapshot.ts')).toContain('fxMapForKpiCompute');
    expect(read('services/dashboardKpiSnapshot.ts')).toMatch(/getSarPerUsdForCalendarDay\([^)]+fxMap/);
  });

  it('single navigation path with hash echo suppression', () => {
    const shell = read('components/AuthenticatedAppShell.tsx');
    expect(shell).toContain('suppressNextHashChangeRef');
    expect(shell).toContain('resumeQuoteRefreshAfterNav');
    expect(shell).toContain('prefetchPage(page)');
    expect(shell).toContain('NAV_TRANSITION_PAUSE_MS');
    expect(read('utils/navigationBridge.ts')).toContain('registerQuoteRefreshResume');
    expect(read('components/Layout.tsx')).toContain('registerQuoteRefreshResume');
    expect(read('components/Layout.tsx')).not.toContain('navigatePage = useCallback');
    expect(read('hooks/useBackgroundWorkInputPause.ts')).toContain('data-nav-link');
  });

  it('canonical extended metrics stale-while-revalidate', () => {
    const ctx = read('context/CanonicalFinancialMetricsContext.tsx');
    expect(ctx).toMatch(
      /}, \[extendedFingerprint, metricsData, exchangeRate, getAvailableCashForAccount, kpiQuotePrices\]\)/,
    );
    expect(ctx).toContain('compactQuotePriceFingerprint');
    expect(ctx).not.toMatch(/\[extendedFingerprint[\s\S]{0,120}fastBundle/);
    expect(ctx).toContain('overlayLiveQuoteTierOntoExtendedMetrics');
  });

  it('notifications read-state merge and dismiss grace', () => {
    expect(read('context/NotificationsContext.tsx')).toContain('dismissGraceUntilRef');
    expect(read('components/HeaderAlertsPopover.tsx')).toContain('markAsRead(n.id)');
  });
});
