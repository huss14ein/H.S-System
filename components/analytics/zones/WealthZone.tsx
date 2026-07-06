import React from 'react';
import type { FinancialData, Page } from '../../../types';
import type { PersonalHeadlineNetWorthResult } from '../../../services/personalNetWorth';
import type { WealthSummaryReportModel } from '../../../services/wealthSummaryReportModel';
import type { HeadlineInvestmentAllocationSlices } from '../../../services/headlineInvestmentAllocation';
import type { SimulatedPriceMap } from '../../../services/investmentPlatformCardMetrics';
import { SummaryWealthAtlasSection } from '../wealthAnalyticsLazySections';
import { WealthHealthIndicatorsDeferredSection } from '../WealthAnalyticsDeferredSections';
import { SectionLoadingPlaceholder } from '../../shared/SectionLoadingPlaceholder';

type Props = {
  dir: 'rtl' | 'ltr';
  extendedReady: boolean;
  headline: { buckets: PersonalHeadlineNetWorthResult['buckets'] };
  netWorthSar: number;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  investmentsTotalSar: number;
  personalInvestments: FinancialData['investments'];
  simulatedPrices: SimulatedPriceMap;
  sarPerUsd: number;
  data: FinancialData;
  goals: FinancialData['goals'];
  reportModel: WealthSummaryReportModel | null | undefined;
  setActivePage?: (page: Page) => void;
};

export const WealthZone: React.FC<Props> = (props) => (
  <div className="space-y-6">
    {props.extendedReady && props.reportModel ? (
      <WealthHealthIndicatorsDeferredSection
        metricsExtendedReady
        discipline={props.reportModel.discipline}
        liquidityRunway={props.reportModel.liquidityRunway}
        investmentAllocation={props.investmentAllocation}
        sarPerUsd={props.sarPerUsd}
      />
    ) : (
      <SectionLoadingPlaceholder labelKey="analyticsHealthLoading" minHeight="6rem" />
    )}
    <section className="min-w-0 w-full" aria-label="Wealth atlas">
      {props.extendedReady ? (
        <SummaryWealthAtlasSection
          dir={props.dir}
          buckets={props.headline.buckets}
          netWorthSar={props.netWorthSar}
          investmentAllocation={props.investmentAllocation}
          investmentsTotalSar={props.investmentsTotalSar}
          personalInvestments={props.personalInvestments}
          simulatedPrices={props.simulatedPrices}
          sarPerUsd={props.sarPerUsd}
          data={props.data}
          goals={props.goals}
          onOpenGoals={props.setActivePage ? () => props.setActivePage!('Goals') : undefined}
          showLanguageToggle={false}
        />
      ) : (
        <SectionLoadingPlaceholder labelKey="analyticsAtlasLoading" minHeight="14rem" />
      )}
    </section>
  </div>
);

export default WealthZone;
