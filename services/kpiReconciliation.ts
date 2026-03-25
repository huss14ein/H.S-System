import type { FinancialMetricsWithEf } from './wealthSummaryReportModel';

export type ReconciledKpiKey =
  | 'netWorth'
  | 'monthlyPnL'
  | 'budgetVariance'
  | 'investmentRoi'
  | 'emergencyFundMonths';

export interface ReconciledKpiRow {
  key: ReconciledKpiKey;
  label: string;
  dashboardValue: number;
  summaryValue: number;
  deltaAbs: number;
  deltaPct: number;
  thresholdAbs: number;
  thresholdPct: number;
  withinThreshold: boolean;
}

export interface KpiReconciliationResult {
  rows: ReconciledKpiRow[];
  ok: boolean;
  mismatchCount: number;
}

const DEFAULT_THRESHOLDS: Record<ReconciledKpiKey, { abs: number; pct: number }> = {
  netWorth: { abs: 1, pct: 0.0005 },
  monthlyPnL: { abs: 1, pct: 0.005 },
  budgetVariance: { abs: 1, pct: 0.005 },
  investmentRoi: { abs: 0.0005, pct: 0.02 },
  emergencyFundMonths: { abs: 0.05, pct: 0.02 },
};

function toFinite(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function reconcileDashboardVsSummaryKpis(args: {
  dashboard: {
    netWorth: number;
    monthlyPnL: number;
    budgetVariance: number;
    roi: number;
    emergencyFundMonths: number;
  };
  summaryMetrics: FinancialMetricsWithEf;
  summaryMonthlyExtras: { budgetVariance: number; roi: number };
  thresholds?: Partial<Record<ReconciledKpiKey, { abs: number; pct: number }>>;
}): KpiReconciliationResult {
  const t = { ...DEFAULT_THRESHOLDS, ...(args.thresholds ?? {}) };
  const summaryMonthlyPnL = toFinite(args.summaryMetrics.monthlyIncome) - toFinite(args.summaryMetrics.monthlyExpenses);
  const comparables: Array<{ key: ReconciledKpiKey; label: string; dashboard: number; summary: number }> = [
    { key: 'netWorth', label: 'Net worth', dashboard: args.dashboard.netWorth, summary: args.summaryMetrics.netWorth },
    { key: 'monthlyPnL', label: "This month's P&L", dashboard: args.dashboard.monthlyPnL, summary: summaryMonthlyPnL },
    { key: 'budgetVariance', label: 'Budget variance', dashboard: args.dashboard.budgetVariance, summary: args.summaryMonthlyExtras.budgetVariance },
    { key: 'investmentRoi', label: 'Investment ROI', dashboard: args.dashboard.roi, summary: args.summaryMonthlyExtras.roi },
    { key: 'emergencyFundMonths', label: 'Emergency fund months', dashboard: args.dashboard.emergencyFundMonths, summary: args.summaryMetrics.emergencyFundMonths },
  ];

  const rows: ReconciledKpiRow[] = comparables.map((c) => {
    const dashboardValue = toFinite(c.dashboard);
    const summaryValue = toFinite(c.summary);
    const deltaAbs = Math.abs(dashboardValue - summaryValue);
    const denom = Math.max(Math.abs(summaryValue), 1e-9);
    const deltaPct = deltaAbs / denom;
    const thresholdAbs = toFinite(t[c.key].abs);
    const thresholdPct = toFinite(t[c.key].pct);
    const withinThreshold = deltaAbs <= thresholdAbs || deltaPct <= thresholdPct;
    return {
      key: c.key,
      label: c.label,
      dashboardValue,
      summaryValue,
      deltaAbs,
      deltaPct,
      thresholdAbs,
      thresholdPct,
      withinThreshold,
    };
  });

  const mismatchCount = rows.filter((r) => !r.withinThreshold).length;
  return {
    rows,
    ok: mismatchCount === 0,
    mismatchCount,
  };
}

