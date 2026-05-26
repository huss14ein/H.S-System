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
    expect(read('components/charts/NetWorthCockpit.tsx')).toContain('NetWorthCockpitFromCanonical');
  });

  it('auto NW snapshot throttle is used on Dashboard and Summary', () => {
    expect(read('pages/Dashboard.tsx')).toContain('shouldThrottleAutoNetWorthSnapshot');
    expect(read('pages/Summary.tsx')).toContain('shouldThrottleAutoNetWorthSnapshot');
    expect(read('services/netWorthSnapshotThrottle.ts')).toContain('MATERIAL_NW_CHANGE_PCT');
  });

  it('idle route prefetch is registered from the authenticated shell', () => {
    const lazy = read('utils/lazyPages.tsx');
    expect(lazy).toContain('prefetchCommonPagesIdle');
    expect(lazy).toMatch(/'Budgets'/);
    expect(lazy).toMatch(/'Transactions'/);
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('prefetchCommonPagesIdle()');
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

  it('KPI drift telemetry is logged from Dashboard', () => {
    expect(read('pages/Dashboard.tsx')).toContain('logKpiReconciliationDrift');
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
    expect(read('context/CanonicalFinancialMetricsContext.tsx')).toContain('buildCanonicalFinancialMetricsResult');
    expect(read('hooks/useCanonicalFinancialMetrics.ts')).toContain('useCanonicalFinancialMetricsContext');
  });

  it('MarketSimulator filters no-op holding updates', () => {
    expect(read('components/MarketSimulator.tsx')).toContain('filterNoOpHoldingValueUpdates');
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
    for (const file of ['LogicEnginesHub.tsx', 'EnginesAndToolsHub.tsx', 'RiskTradingHub.tsx', 'Forecast.tsx']) {
      const src = read(`pages/${file}`);
      expect(src).toContain('useDashboardCanonicalMetrics');
    }
  });
});
