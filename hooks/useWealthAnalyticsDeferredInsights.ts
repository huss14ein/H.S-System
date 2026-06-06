import { useContext, useEffect, useState, startTransition } from 'react';
import type { FinancialData, Goal, Transaction } from '../types';
import { DataContext } from '../context/DataContext';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { attributeNetWorthWithFlows } from '../services/portfolioAttribution';
import { personalNetCashflowBetween } from '../services/netWorthPeriodFlows';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { reconcileDashboardVsSummaryKpis } from '../services/kpiReconciliation';
import type { DashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import type { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';

type ReportModel = NonNullable<ReturnType<typeof computeWealthSummaryReportModel>>;
type NwSnapshotInsight = {
  snaps: ReturnType<typeof listNetWorthSnapshots>;
  attr: ReturnType<typeof attributeNetWorthWithFlows> | null;
};

const EMPTY_NW_INSIGHT: NwSnapshotInsight = { snaps: [], attr: null };

/** Idle / expand-gated insights — keeps Wealth Analytics hero path off heavy engines. */
export function useWealthAnalyticsDeferredInsights(args: {
  enabled: boolean;
  data: FinancialData | null | undefined;
  personalTransactions: Transaction[];
  goals: Goal[];
  emergencyFundMonths: number;
  strictReconciliationMode: boolean;
  reportModel: ReportModel | null | undefined;
  /** Dashboard KPI row — same bundle as Dashboard / Summary (`computeDashboardKpiSnapshot`). */
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
}): {
  nextBestActions: ReturnType<typeof generateNextBestActions>;
  nwSnapshotInsight: NwSnapshotInsight;
  kpiReconciliation: ReturnType<typeof reconcileDashboardVsSummaryKpis> | null;
  ready: boolean;
} {
  const { showHydrateBanner } = useContext(DataContext)!;
  const [nextBestActions, setNextBestActions] = useState<ReturnType<typeof generateNextBestActions>>([]);
  const [nwSnapshotInsight, setNwSnapshotInsight] = useState<NwSnapshotInsight>(EMPTY_NW_INSIGHT);
  const [kpiReconciliation, setKpiReconciliation] = useState<
    ReturnType<typeof reconcileDashboardVsSummaryKpis> | null
  >(null);
  const [ready, setReady] = useState(false);

  const {
    enabled,
    data,
    personalTransactions,
    goals,
    emergencyFundMonths,
    strictReconciliationMode,
    reportModel,
    kpiSnapshot,
  } = args;

  const fingerprint = [
    enabled ? '1' : '0',
    data?.transactions?.length ?? 0,
    goals.length,
    emergencyFundMonths,
    strictReconciliationMode ? '1' : '0',
    reportModel ? '1' : '0',
    kpiSnapshot?.netWorth ?? 0,
    kpiSnapshot?.monthlyPnL ?? 0,
    kpiSnapshot?.budgetVariance ?? 0,
    kpiSnapshot?.roi ?? 0,
  ].join(':');

  useEffect(() => {
    if (!enabled || !data || showHydrateBanner) {
      setNextBestActions([]);
      setNwSnapshotInsight(EMPTY_NW_INSIGHT);
      setKpiReconciliation(null);
      setReady(false);
      return;
    }

    setReady(false);
    return scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused()) return;

      const salaryCov = salaryToExpenseCoverage(personalTransactions, 6);
      const goalAlerts = goals.map((g) => ({
        goalId: g.id,
        name: g.name,
        allocPct: Number(g.savingsAllocationPercent) || 0,
      }));
      const actions = generateNextBestActions({
        emergencyFundMonths,
        runwayMonths: emergencyFundMonths,
        goalAlerts,
        salaryCoverageRatio: salaryCov?.ratio ?? undefined,
        nwSnapshotCount: listNetWorthSnapshots().length,
      });

      await yieldToMain(16);
      if (isBackgroundWorkPaused()) return;

      const snaps = listNetWorthSnapshots();
      let attr: ReturnType<typeof attributeNetWorthWithFlows> | null = null;
      if (snaps.length >= 2) {
        const a = snaps[1];
        const b = snaps[0];
        const flow = personalNetCashflowBetween(personalTransactions, a.at, b.at);
        attr = attributeNetWorthWithFlows({
          startNw: a.netWorth,
          endNw: b.netWorth,
          externalCashflow: flow,
        });
      }

      await yieldToMain(16);
      if (isBackgroundWorkPaused()) return;

      let reconciliation: ReturnType<typeof reconcileDashboardVsSummaryKpis> | null = null;
      if (strictReconciliationMode && reportModel && kpiSnapshot) {
        reconciliation = reconcileDashboardVsSummaryKpis({
          dashboard: {
            netWorth: Number(kpiSnapshot.netWorth ?? 0),
            monthlyPnL: Number(kpiSnapshot.monthlyPnL ?? 0),
            budgetVariance: Number(kpiSnapshot.budgetVariance ?? 0),
            roi: Number(kpiSnapshot.roi ?? 0),
            emergencyFundMonths: Number(emergencyFundMonths ?? 0),
          },
          summaryMetrics: reportModel.financialMetricsWithEf,
          summaryMonthlyExtras: {
            budgetVariance: kpiSnapshot.budgetVariance ?? 0,
            roi: kpiSnapshot.roi ?? 0,
          },
        });
      }

      startTransition(() => {
        setNextBestActions(actions);
        setNwSnapshotInsight({ snaps, attr });
        setKpiReconciliation(reconciliation);
        setReady(true);
      });
    }, 800);
  }, [
    enabled,
    data,
    showHydrateBanner,
    personalTransactions,
    goals,
    emergencyFundMonths,
    strictReconciliationMode,
    reportModel,
    kpiSnapshot,
    fingerprint,
  ]);

  return { nextBestActions, nwSnapshotInsight, kpiReconciliation, ready };
}
