import React from 'react';
import type { FinancialData } from '../../types';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import type { PersonalHeadlineNetWorthResult } from '../../services/personalNetWorth';
import type { HeadlineInvestmentAllocationSlices } from '../../services/headlineInvestmentAllocation';
import { useEmergencyFund } from '../../hooks/useEmergencyFund';
import { useExecutiveKpiSparklines } from '../../hooks/useExecutiveKpiSparklines';
import { useEnhancementSignals } from '../../hooks/useEnhancementSignals';
import { ExecutiveKpiGrid } from './ExecutiveKpiGrid';
import { WealthHealthIndicators } from './WealthHealthIndicators';

/** KPI grid mounts only when scrolled into view — keeps Wealth Analytics first paint light. */
export const WealthAnalyticsExecutiveKpiSection: React.FC<{
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  data: FinancialData | null | undefined;
  showHydrateBanner: boolean;
}> = ({ headline, kpiSnapshot, data, showHydrateBanner }) => {
  const emergencyFund = useEmergencyFund(data);
  const netWorthSparkline = useExecutiveKpiSparklines(!showHydrateBanner && !!data);

  return (
    <ExecutiveKpiGrid
      headline={headline}
      kpiSnapshot={kpiSnapshot}
      emergencyFundMonths={emergencyFund.monthsCovered}
      emergencyFundTargetSar={emergencyFund.targetAmount}
      hideWeeklyPnL
      netWorthSparklineOverride={netWorthSparkline}
    />
  );
};

export const WealthHealthIndicatorsDeferredSection: React.FC<{
  metricsExtendedReady: boolean;
  discipline: React.ComponentProps<typeof WealthHealthIndicators>['discipline'];
  liquidityRunway: React.ComponentProps<typeof WealthHealthIndicators>['liquidityRunway'];
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  sarPerUsd: number;
}> = ({ metricsExtendedReady, discipline, liquidityRunway, investmentAllocation, sarPerUsd }) => {
  const { budgetDrift } = useEnhancementSignals(metricsExtendedReady ? sarPerUsd : undefined);

  return (
    <WealthHealthIndicators
      discipline={discipline}
      liquidityRunway={liquidityRunway}
      investmentAllocation={investmentAllocation}
      budgetDriftTopCategory={budgetDrift[0]?.category}
      budgetDriftPct={budgetDrift[0]?.driftPct}
    />
  );
};
