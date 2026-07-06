import React from 'react';
import type { FinancialData, Page } from '../../../types';
import type { PersonalHeadlineNetWorthResult } from '../../../services/personalNetWorth';
import type { DashboardKpiSnapshot } from '../../../services/dashboardKpiSnapshot';
import type { WealthSummaryReportModel } from '../../../services/wealthSummaryReportModel';
import type { HeadlineInvestmentAllocationSlices } from '../../../services/headlineInvestmentAllocation';
import type { ExpenseBudgetAnalysisModel } from '../../../services/expenseBudgetAnalysisModel';
import { WealthAnalyticsHero } from '../WealthAnalyticsHero';
import WealthPulseRing from '../WealthPulseRing';
import WealthChangeWaterfallChart from '../WealthChangeWaterfallChart';
import { buildWealthChangeWaterfallSteps } from '../../../services/wealthChangeWaterfallModel';
import {
  WealthHealthIndicatorsDeferredSection,
  WealthAnalyticsExecutiveKpiSection,
} from '../WealthAnalyticsDeferredSections';
import { SectionLoadingPlaceholder } from '../../shared/SectionLoadingPlaceholder';
import SpendingCommandCenter from '../../spending/SpendingCommandCenter';

type Props = {
  netWorthDisplay: string;
  netWorthSar: number;
  monthlyPnLDisplay: string;
  monthlyPnLPositive: boolean;
  roiDisplay: string;
  roiPositive: boolean;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  data: FinancialData | null | undefined;
  showHydrateBanner: boolean;
  extendedReady: boolean;
  reportModel: WealthSummaryReportModel | null | undefined;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  sarPerUsd: number;
  spendingModel: ExpenseBudgetAnalysisModel | null;
  spendingReady: boolean;
  formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
};

export const OverviewZone: React.FC<Props> = ({
  netWorthDisplay,
  netWorthSar,
  monthlyPnLDisplay,
  monthlyPnLPositive,
  roiDisplay,
  roiPositive,
  headline,
  kpiSnapshot,
  data,
  showHydrateBanner,
  extendedReady,
  reportModel,
  investmentAllocation,
  sarPerUsd,
  spendingModel,
  spendingReady,
  formatCurrencyString,
  setActivePage,
  triggerPageAction,
}) => {
  const buckets = headline.buckets;
  const segments = [
    { id: 'cash', label: 'Cash', valueSar: buckets.cash, color: '#10b981', onClick: () => setActivePage?.('Accounts') },
    { id: 'inv', label: 'Invest', valueSar: buckets.investments, color: '#8b5cf6', onClick: () => setActivePage?.('Investments') },
    { id: 'phys', label: 'Physical', valueSar: buckets.physicalAndCommodities, color: '#f59e0b', onClick: () => setActivePage?.('Assets') },
    { id: 'debt', label: 'Debt', valueSar: Math.abs(buckets.liabilities), color: '#f43f5e', onClick: () => setActivePage?.('Liabilities') },
  ];
  const waterfallSteps = buildWealthChangeWaterfallSteps({
    netWorthSar,
    monthlyPnLSar: kpiSnapshot?.monthlyPnL ?? 0,
    buckets,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <WealthAnalyticsHero
          netWorthDisplay={netWorthDisplay}
          monthlyPnLDisplay={monthlyPnLDisplay}
          monthlyPnLPositive={monthlyPnLPositive}
          roiDisplay={roiDisplay}
          roiPositive={roiPositive}
        />
        <WealthPulseRing
          netWorthSar={netWorthSar}
          segments={segments}
          formatCurrency={(n) => formatCurrencyString(n, { digits: 0 })}
          className="mx-auto lg:mx-0"
        />
      </div>
      <WealthChangeWaterfallChart
        steps={waterfallSteps}
        formatCurrency={(n) => formatCurrencyString(n, { digits: 0 })}
      />
      <WealthAnalyticsExecutiveKpiSection
        headline={headline}
        kpiSnapshot={kpiSnapshot}
        data={data}
        showHydrateBanner={showHydrateBanner}
      />
      {extendedReady && reportModel ? (
        <WealthHealthIndicatorsDeferredSection
          metricsExtendedReady
          discipline={reportModel.discipline}
          liquidityRunway={reportModel.liquidityRunway}
          investmentAllocation={investmentAllocation}
          sarPerUsd={sarPerUsd}
        />
      ) : (
        <SectionLoadingPlaceholder labelKey="analyticsHealthLoading" minHeight="6rem" />
      )}
      {spendingReady && spendingModel && (
        <SpendingCommandCenter
          model={spendingModel}
          ready={spendingReady}
          compact
          setActivePage={setActivePage}
          triggerPageAction={triggerPageAction}
        />
      )}
    </div>
  );
};

export default OverviewZone;
