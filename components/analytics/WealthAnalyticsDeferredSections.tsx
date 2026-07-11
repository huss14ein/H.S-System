import React, { useMemo } from 'react';
import type { FinancialData, Page } from '../../types';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import type { PersonalHeadlineNetWorthResult } from '../../services/personalNetWorth';
import type { HeadlineInvestmentAllocationSlices } from '../../services/headlineInvestmentAllocation';
import type { WealthSummaryReportModel } from '../../services/wealthSummaryReportModel';
import { useEmergencyFund } from '../../hooks/useEmergencyFund';
import { useExecutiveKpiSparklines } from '../../hooks/useExecutiveKpiSparklines';
import { useEnhancementSignals } from '../../hooks/useEnhancementSignals';
import { useOpenMetricPassport } from '../../hooks/useOpenMetricPassport';
import { buildWealthAnalyticsReportModel } from '../../services/wealthAnalyticsReportModel';
import type { MetricPassportModel } from '../../services/metricPassportModel';
import type { PortfolioPeriodPnLSnapshot } from '../../hooks/usePortfolioPeriodPnLSnapshot';
import type { SimulatedPriceMap } from '../../services/investmentPlatformCardMetrics';
import { ExecutiveKpiGrid } from './ExecutiveKpiGrid';
import { WealthHealthIndicators } from './WealthHealthIndicators';

const KPI_PASSPORT_KEYS: Record<string, MetricPassportModel['key']> = {
  netWorth: 'netWorth',
  monthlyPnL: 'monthlyPnL',
  emergencyFund: 'emergencyFund',
  budgetVariance: 'budgetVariance',
  investmentRoi: 'investmentRoi',
  weeklyPnL: 'weeklyPnL',
  portfolioPeriodPnL: 'portfolioPeriodPnL',
};

/** KPI grid mounts only when scrolled into view — keeps Wealth Analytics first paint light. */
export const WealthAnalyticsExecutiveKpiSection: React.FC<{
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  data: FinancialData | null | undefined;
  showHydrateBanner: boolean;
  portfolioPeriodPnL: PortfolioPeriodPnLSnapshot;
  reportModel: WealthSummaryReportModel | null | undefined;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  investmentsTotalSar: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  quotesAsOfIso?: string | null;
  quotesLive?: boolean;
}> = ({
  headline,
  kpiSnapshot,
  data,
  showHydrateBanner,
  portfolioPeriodPnL,
  reportModel,
  sarPerUsd,
  simulatedPrices,
  investmentsTotalSar,
  getAvailableCashForAccount,
  quotesAsOfIso,
  quotesLive,
}) => {
  const emergencyFund = useEmergencyFund(data);
  const netWorthSparkline = useExecutiveKpiSparklines(!showHydrateBanner && !!data);

  const exportModel = useMemo(() => {
    if (!data || !reportModel) return null;
    return buildWealthAnalyticsReportModel({
      wealthSummaryPayload: reportModel.wealthSummaryReportPayload,
      headline,
      kpiSnapshot,
      emergencyFund,
      data,
      sarPerUsd,
      simulatedPrices,
      investmentsTotalSar,
      getAvailableCashForAccount,
      quotesAsOfIso,
      quotesLive,
    });
  }, [
    data,
    reportModel,
    headline,
    kpiSnapshot,
    emergencyFund,
    sarPerUsd,
    simulatedPrices,
    investmentsTotalSar,
    getAvailableCashForAccount,
    quotesAsOfIso,
    quotesLive,
  ]);

  const openPassport = useOpenMetricPassport(exportModel);

  const weeklyPnLSar = portfolioPeriodPnL.ready ? portfolioPeriodPnL.weeklyTotalSar : 0;
  const weeklyPnLSparkline = useMemo(
    () =>
      portfolioPeriodPnL.sparklinesReady && portfolioPeriodPnL.weeklySparkline.length >= 2
        ? portfolioPeriodPnL.weeklySparkline
        : undefined,
    [portfolioPeriodPnL.sparklinesReady, portfolioPeriodPnL.weeklySparkline],
  );

  const handleExplain = (key: string) => {
    const passportKey = KPI_PASSPORT_KEYS[key];
    if (passportKey) openPassport(passportKey);
  };

  return (
    <ExecutiveKpiGrid
      headline={headline}
      kpiSnapshot={kpiSnapshot}
      emergencyFundMonths={emergencyFund.monthsCovered}
      emergencyFundTargetSar={emergencyFund.targetAmount}
      weeklyPnLSar={weeklyPnLSar}
      weeklyPnLLoading={!portfolioPeriodPnL.ready}
      weeklyPnLSparkline={weeklyPnLSparkline}
      netWorthSparklineOverride={netWorthSparkline}
      onExplain={handleExplain}
    />
  );
};

export const WealthHealthIndicatorsDeferredSection: React.FC<{
  metricsExtendedReady: boolean;
  discipline: React.ComponentProps<typeof WealthHealthIndicators>['discipline'];
  liquidityRunway: React.ComponentProps<typeof WealthHealthIndicators>['liquidityRunway'];
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  sarPerUsd: number;
  setActivePage?: (page: Page) => void;
}> = ({ metricsExtendedReady, discipline, liquidityRunway, investmentAllocation, sarPerUsd, setActivePage }) => {
  const { budgetDrift } = useEnhancementSignals(metricsExtendedReady ? sarPerUsd : undefined);

  return (
    <WealthHealthIndicators
      discipline={discipline}
      liquidityRunway={liquidityRunway}
      investmentAllocation={investmentAllocation}
      budgetDriftTopCategory={budgetDrift[0]?.category}
      budgetDriftPct={budgetDrift[0]?.driftPct}
      setActivePage={setActivePage}
    />
  );
};
