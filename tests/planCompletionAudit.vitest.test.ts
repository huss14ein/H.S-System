/**
 * Cross-phase audit — catches wiring gaps that unit tests alone can miss.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

describe('Plan completion audit (A–I)', () => {
  it('Phase A — transaction scope + fiscal drill-down wired', () => {
    expect(read('utils/transactionLedgerFilters.ts')).toContain("monthMode");
    expect(read('utils/transactionLedgerFilters.ts')).toContain('ledgerDateRangeForFilters');
    expect(read('utils/transactionLedgerFilters.ts')).toContain('budgetDrillDownDateRange');
    expect(read('pages/Transactions.tsx')).toContain('scopedCashTransactions');
    expect(read('pages/Transactions.tsx')).toContain('ledgerDateRangeForFilters');
    expect(read('pages/Transactions.tsx')).toContain('governanceReady');
    expect(read('context/DataContext.tsx')).toContain('transactionsLoadWarning');
  });

  it('Phase B — snapshot readiness gates Dashboard, Summary, Layout', () => {
    expect(exists('services/netWorthSnapshotReadiness.ts')).toBe(true);
    expect(read('pages/Dashboard.tsx')).toContain('tryAutoCaptureNetWorthSnapshot');
    expect(read('pages/Summary.tsx')).toContain('captureNetWorthSnapshotFromHeadline');
    expect(read('components/Layout.tsx')).toContain('canAutoCaptureNetWorthSnapshot');
  });

  it('Phase C — Wealth Analytics label only (no charts & health)', () => {
    expect(read('constants.tsx')).toContain("'Wealth Analytics': 'Wealth Analytics'");
    expect(read('constants.tsx')).not.toContain('charts & health');
  });

  it('Phase D — P/L charts + Investments sparklines', () => {
    expect(exists('components/analytics/PortfolioPnLTrendCharts.tsx')).toBe(true);
    expect(read('services/portfolioPeriodPnL.ts')).toContain('computePortfolioPnLDailySeries');
    expect(read('pages/Investments.tsx')).toContain('MiniPnLSparkline');
  });

  it('Phase E — executive KPI grid includes weekly P/L card', () => {
    expect(read('components/analytics/ExecutiveKpiGrid.tsx')).toContain('weeklyPnLKpi');
    expect(read('components/analytics/ExecutiveKpiGrid.tsx')).toContain('weeklyPnLSar');
    expect(read('components/analytics/WealthAnalyticsDeferredSections.tsx')).toContain('hideWeeklyPnL');
  });

  it('Phase F/G — layout order + PDF export + language toggle', () => {
    const wa = read('pages/WealthAnalytics.tsx');
    const deferred = read('components/analytics/WealthAnalyticsDeferredSections.tsx');
    expect(wa).toContain('WealthAnalyticsExportMenuSection');
    expect(deferred).toContain('ExecutiveKpiGrid');
    expect(wa.indexOf('<WealthAnalyticsExecutiveKpiSection')).toBeLessThan(wa.indexOf('<PortfolioPeriodPnLPanelSection'));
    expect(read('components/analytics/WealthAnalyticsExportMenu.tsx')).toContain('PageLanguageToggle');
    expect(read('services/reportingEngine.ts')).toContain('generateWealthExecutiveSummaryHtml');
    expect(read('services/reportingEngine.ts')).toContain('sparklineSvg');
  });

  it('Phase H — multi-stock AI on Investments and Wealth Analytics', () => {
    expect(exists('services/multiSymbolMarketGrounding.ts')).toBe(true);
    expect(read('services/geminiService.ts')).toContain('getAIMultiStockAnalysis');
    expect(read('pages/InvestmentOverview.tsx')).toContain('MultiStockAnalysisPanel');
    expect(read('pages/WatchlistView.tsx')).toContain('MultiStockAnalysisPanel');
    expect(read('pages/WealthAnalytics.tsx')).toContain('WealthAnalyticsDetailsSectionLazy');
    expect(read('components/analytics/WealthAnalyticsDetailsSection.tsx')).toContain('MultiStockAnalysisSection');
    expect(read('docs/AI_GROUNDING.md')).toContain('getAIMultiStockAnalysis');
  });

  it('Phase I — full verification suite files exist', () => {
    for (const f of [
      'tests/phaseAbcCompletion.vitest.test.ts',
      'tests/phaseDeCompletion.vitest.test.ts',
      'tests/phaseFgCompletion.vitest.test.ts',
      'tests/phaseHiCompletion.vitest.test.ts',
      'tests/wealthAnalyticsPdf.vitest.test.ts',
      'tests/planCompletionAudit.vitest.test.ts',
    ]) {
      expect(exists(f), f).toBe(true);
    }
  });
});
