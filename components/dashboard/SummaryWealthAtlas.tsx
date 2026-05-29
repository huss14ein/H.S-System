import React from 'react';
import type { FinancialData, Goal } from '../../types';
import type { InvestmentPortfolio } from '../../types';
import type { PersonalNetWorthChartBucketsSAR } from '../../services/personalNetWorth';
import type { HeadlineInvestmentAllocationSlices } from '../../services/headlineInvestmentAllocation';
import { DashboardSectionHeader } from './DashboardSectionHeader';
import { NetWorthCompositionChart } from './NetWorthCompositionChart';
import { InvestmentAllocationRings } from './InvestmentAllocationRings';
import { HoldingsBubbleChart } from './HoldingsBubbleChart';
import { Goals2030JourneyMap } from './Goals2030JourneyMap';
import { GoalProjectionAreaChart } from './GoalProjectionAreaChart';
import { DeferredMount } from './DeferredMount';

/** Summary-only: wealth composition, allocation, holdings map, goals journey. */
export const SummaryWealthAtlas: React.FC<{
  dir: 'ltr' | 'rtl';
  buckets: PersonalNetWorthChartBucketsSAR;
  netWorthSar: number;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  investmentsTotalSar: number;
  personalInvestments: InvestmentPortfolio[];
  simulatedPrices: Record<string, { price: number }>;
  sarPerUsd: number;
  data: FinancialData | null | undefined;
  goals: Goal[];
  onOpenGoals?: () => void;
}> = ({
  dir,
  buckets,
  netWorthSar,
  investmentAllocation,
  investmentsTotalSar,
  personalInvestments,
  simulatedPrices,
  sarPerUsd,
  data,
  goals,
  onOpenGoals,
}) => (
  <div dir={dir} className="mb-6 space-y-4">
    <DashboardSectionHeader titleKey="summaryAtlasTitle" subtitleKey="summaryAtlasSubtitle" />
    <NetWorthCompositionChart buckets={buckets} netWorthSar={netWorthSar} />
    <DeferredMount minHeight="14rem">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <InvestmentAllocationRings allocation={investmentAllocation} investmentsTotalSar={investmentsTotalSar} />
        <HoldingsBubbleChart portfolios={personalInvestments} simulatedPrices={simulatedPrices} sarPerUsd={sarPerUsd} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <Goals2030JourneyMap data={data} goals={goals} sarPerUsd={sarPerUsd} onOpenGoals={onOpenGoals} />
        <GoalProjectionAreaChart data={data} goals={goals} sarPerUsd={sarPerUsd} />
      </div>
    </DeferredMount>
  </div>
);
