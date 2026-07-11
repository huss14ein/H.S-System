/**
 * Wealth Analytics studio — Phase 6A wiring guards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('wealthAnalyticsStudio', () => {
  it('lazy-mounts only the active wealth zone', () => {
    const page = read('pages/WealthAnalytics.tsx');
    expect(page).toContain("wealthZone === 'overview'");
    expect(page).toContain("wealthZone === 'wealth'");
    expect(page).toContain("wealthZone === 'investments'");
    expect(page).toContain("wealthZone === 'cash'");
    expect(page).not.toMatch(/wealthZone === 'overview' \|\| wealthZone === 'wealth'/);
  });

  it('insight rail uses buildAnalyticsInsightFeed + visit delta', () => {
    expect(read('components/analytics/AnalyticsInsightRail.tsx')).toContain('buildAnalyticsInsightFeed');
    expect(read('components/analytics/AnalyticsInsightRail.tsx')).toContain('visitDelta');
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('AnalyticsInsightRail');
  });

  it('cross-filter ribbon on overview and cash zones', () => {
    expect(read('components/analytics/AnalyticsCrossFilterRibbon.tsx')).toContain('Cross-filter');
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('AnalyticsCrossFilterRibbon');
    expect(read('components/analytics/zones/CashSpendZone.tsx')).toContain('AnalyticsCrossFilterRibbon');
  });

  it('waterfall bar clicks route to investments and transactions', () => {
    expect(read('components/analytics/WealthChangeWaterfallChart.tsx')).toContain('onStepClick');
    expect(read('components/analytics/zones/OverviewZone.tsx')).toContain('onWaterfallMarketClick');
    expect(read('pages/WealthAnalytics.tsx')).toContain("setWealthZone('investments')");
    expect(read('pages/WealthAnalytics.tsx')).toContain("setActivePage?.('Transactions')");
  });

  it('executive KPI explain opens metric passport', () => {
    expect(read('components/analytics/ExecutiveKpiCard.tsx')).toContain('onExplain');
    expect(read('components/analytics/WealthAnalyticsDeferredSections.tsx')).toContain('useOpenMetricPassport');
    expect(read('components/analytics/WealthAnalyticsDeferredSections.tsx')).toContain('buildWealthAnalyticsReportModel');
  });

  it('portfolio period P/L row opens breakdown drawer', () => {
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('PortfolioPeriodPnLBreakdownDrawer');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('openBreakdown');
  });

  it('wealth zone includes mini waterfall bridge with step routing', () => {
    const wealth = read('components/analytics/zones/WealthZone.tsx');
    expect(wealth).toContain('WealthChangeWaterfallChart');
    expect(wealth).toContain('buildWealthChangeWaterfallSteps');
    expect(wealth).toContain('compact');
    expect(wealth).toContain('onStepClick');
    expect(wealth).toContain('sumPersonalSukukPositionsSar');
    expect(read('pages/WealthAnalytics.tsx')).toContain('onWaterfallMarketClick');
  });

  it('export menu includes weekly and portfolio period passport keys', () => {
    const menu = read('components/analytics/WealthAnalyticsExportMenu.tsx');
    expect(menu).toContain('WEALTH_METRIC_PASSPORT_LABELS');
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain("'weeklyPnL'");
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain("'portfolioPeriodPnL'");
  });

  it('visit delta action chips on wealth analytics', () => {
    expect(read('pages/WealthAnalytics.tsx')).toContain('AnalyticsVisitDeltaChips');
  });
});
