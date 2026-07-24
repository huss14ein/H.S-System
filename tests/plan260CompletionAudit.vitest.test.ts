/**
 * Plan 2.6 feature completion audit — Sukuk, corporate actions, spending, ultra analytics.
 * Current packaged app version is asserted as 2.7.0.0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

const REQUIRED_TESTS = [
  'tests/sukukInvestmentsE2EWiring.vitest.test.ts',
  'tests/sukukPayoutLifecycle.vitest.test.ts',
  'tests/corporateActionsReplay.vitest.test.ts',
  'tests/corporateActionIdempotency.vitest.test.ts',
  'tests/corporateActionUndo.vitest.test.ts',
  'tests/dripExecution.vitest.test.ts',
  'tests/corporateActionSecurity.vitest.test.ts',
  'tests/expenseBudgetScenarios.vitest.test.ts',
  'tests/spendingCommandCenterCoverage.vitest.test.ts',
  'tests/spendingModelSinglePath.vitest.test.ts',
  'tests/spendingDrillDownWiring.vitest.test.ts',
  'tests/ultraAnalyticsWiring.vitest.test.ts',
  'tests/ultraAnalyticsPerformance.vitest.test.ts',
  'tests/analyticsWorkspaceContext.vitest.test.ts',
  'tests/ksaProductScope.vitest.test.ts',
  'tests/portfolioReplayChunked.vitest.test.ts',
  'tests/portfolioLotReplay.vitest.test.ts',
  'tests/budgetCategorySlideOver.vitest.test.ts',
  'tests/wealthAnalyticsZones.vitest.test.ts',
];

describe('plan 2.6 feature completion audit', () => {
  it('version 2.7.0.0 in package and buildInfo', () => {
    expect(read('package.json')).toContain('"version": "2.7.0.0"');
    expect(read('utils/buildInfo.ts')).toContain("APP_VERSION = '2.7.0.0'");
  });

  it('Track A — Sukuk recovery artifacts', () => {
    expect(exists('supabase/migrations/20260706120000_safe_sukuk_backfill.sql')).toBe(true);
    expect(read('services/sukuk/sukukExposure.ts')).toContain('sarPerUsd');
    expect(read('components/investments/SukukInvestmentsSection.tsx')).toMatch(/empty|hint|No sukuk/i);
  });

  it('Track B — corporate actions schema, apply, undo, hydrate, FIFO lots', () => {
    expect(exists('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql')).toBe(true);
    expect(read('services/portfolioReplayEngine.ts')).toContain('rebuildPortfolioFromEvents');
    expect(read('services/portfolioLedgerSync.ts')).toContain('syncPortfolioLedgerAfterChange');
    expect(read('services/portfolioLotReplayEngine.ts')).toContain('rebuildCostLotsFromEvents');
    expect(read('context/DataContext.tsx')).toContain('syncPortfolioAfterLedgerMutation');
    expect(read('context/DataContext.tsx')).toContain('investmentCostLots');
    expect(read('components/investments/CorporateActionApplyPanel.tsx')).toContain('cashInLieuPrice');
  });

  it('Track C — spending command center + drill-downs + exports + budget slide-over', () => {
    expect(read('components/spending/SpendingCommandCenter.tsx')).toContain('SpendingCommandCenter');
    expect(read('pages/Dashboard.tsx')).toContain('useSpendingCommandCenterModel');
    expect(read('pages/Budgets.tsx')).toContain('handleOwnPortfolioNavigate');
    expect(read('pages/Budgets.tsx')).toContain('buildBudgetDrillDownAction');
    expect(read('services/budgetCategorySlideOverModel.ts')).toContain('buildBudgetCategorySlideOverModel');
    expect(read('pages/Budgets.tsx')).toContain('SpendingCommandCenter');
    expect(read('services/spendingDrillDown.ts')).toContain('buildBudgetDrillDownAction');
    expect(read('services/spendingReportExport.ts')).toContain('downloadSpendingBriefPdf');
    expect(read('components/charts/ExpenseBreakdownChart.tsx')).toContain('buildBudgetDrillDownAction');
    expect(read('components/dashboard/ExpenseDonutDrilldown.tsx')).toContain('spendingIntelMapping');
    expect(read('context/NotificationsContext.tsx')).toContain('detectSpendingAnomaliesFromTransactions');
  });

  it('Track D — ultra analytics workspace + zones + creative charts', () => {
    expect(read('pages/WealthAnalytics.tsx')).toContain('AnalyticsPeriodScopeBar');
    expect(read('pages/WealthAnalytics.tsx')).toContain('visitDelta');
    expect(read('pages/Analysis.tsx')).toContain('AnalysisExplorerContent');
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('WealthPulseRing');
    expect(read('components/analytics/WealthChangeWaterfallChart.tsx')).toContain('WealthChangeWaterfallChart');
    expect(read('hooks/useSpendingCommandCenterModel.ts')).toContain('periodPreset');
    expect(read('services/analyticsPeriodRange.ts')).toContain('resolveAnalyticsSpendWindow');
    expect(read('components/spending/SpendingMerchantTreemap.tsx')).toContain('SpendingMerchantTreemap');
  });

  it('required E2E test files exist', () => {
    for (const f of REQUIRED_TESTS) {
      expect(exists(f), f).toBe(true);
    }
  });
});
