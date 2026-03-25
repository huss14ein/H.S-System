import { describe, expect, it } from 'vitest';
import { reconcileDashboardVsSummaryKpis } from '../services/kpiReconciliation';

describe('reconcileDashboardVsSummaryKpis', () => {
  it('passes when values are within thresholds', () => {
    const out = reconcileDashboardVsSummaryKpis({
      dashboard: {
        netWorth: 100_000,
        monthlyPnL: 2_000,
        budgetVariance: 500,
        roi: 0.12,
        emergencyFundMonths: 4.0,
      },
      summaryMetrics: {
        netWorth: 100_001,
        monthlyIncome: 10_000,
        monthlyExpenses: 8_000,
        savingsRate: 0.2,
        debtToAssetRatio: 0.1,
        investmentStyle: 'Balanced',
        netWorthTrend: 2.0,
        emergencyFundMonths: 4.02,
        efStatus: 'green',
        efTrend: 'Healthy',
        emergencyShortfall: 0,
        emergencyTargetAmount: 0,
      },
      summaryMonthlyExtras: { budgetVariance: 501, roi: 0.1201 },
    });
    expect(out.ok).toBe(true);
    expect(out.mismatchCount).toBe(0);
  });

  it('flags mismatches over threshold', () => {
    const out = reconcileDashboardVsSummaryKpis({
      dashboard: {
        netWorth: 100_000,
        monthlyPnL: 2_000,
        budgetVariance: 500,
        roi: 0.12,
        emergencyFundMonths: 4.0,
      },
      summaryMetrics: {
        netWorth: 80_000,
        monthlyIncome: 10_000,
        monthlyExpenses: 7_000,
        savingsRate: 0.3,
        debtToAssetRatio: 0.1,
        investmentStyle: 'Balanced',
        netWorthTrend: 2.0,
        emergencyFundMonths: 6.0,
        efStatus: 'green',
        efTrend: 'Healthy',
        emergencyShortfall: 0,
        emergencyTargetAmount: 0,
      },
      summaryMonthlyExtras: { budgetVariance: -1000, roi: -0.5 },
    });
    expect(out.ok).toBe(false);
    expect(out.mismatchCount).toBeGreaterThan(0);
  });
});

