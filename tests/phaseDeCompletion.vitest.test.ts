/**
 * End-to-end guards for Phases D (P/L charts) and E (Executive KPI grid).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase D — P/L charts E2E', () => {
  it('daily series service and trend charts are wired', () => {
    expect(read('services/portfolioPeriodPnL.ts')).toContain('computePortfolioPnLDailySeries');
    expect(read('components/analytics/PortfolioPnLTrendCharts.tsx')).toContain('PortfolioPnLTrendCharts');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('PortfolioPnLTrendCharts');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
  });

  it('Investments portfolio rows include week P/L sparklines via idle snapshot hook', () => {
    expect(read('pages/Investments.tsx')).toContain('MiniPnLSparkline');
    expect(read('pages/Investments.tsx')).toContain('portfolioWeeklySparklineById');
    expect(read('pages/Investments.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('pages/Investments.tsx')).not.toContain('computePortfolioPnLDailySeries({');
  });
});

describe('Phase E — Executive KPI grid E2E', () => {
  it('Wealth Analytics uses canonical KPI grid, health strip, and quote badge', () => {
    const wa = read('pages/WealthAnalytics.tsx');
    expect(wa).toContain('ExecutiveKpiGrid');
    expect(wa).toContain('WealthHealthIndicatorsSection');
    expect(wa).toContain('WealthAnalyticsExportMenuSection');
    expect(wa).toContain('useCanonicalFinancialMetrics');
    expect(wa).not.toContain('ExecutiveStatusRow');
  });

  it('Executive KPI grid uses snapshot sparklines and six canonical metrics including weekly P/L', () => {
    const grid = read('components/analytics/ExecutiveKpiGrid.tsx');
    expect(grid).toContain('netWorthSparklineFromSnapshots');
    expect(grid).toContain('ExecutiveKpiCard');
    expect(grid).toContain('weeklyPnLKpi');
    expect(grid).toContain('emergencyFund');
    expect(grid).toContain('budgetVariance');
    expect(grid).toContain('investmentRoi');
  });
});
