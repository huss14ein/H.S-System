import React from 'react';
import type { FinancialData, Page } from '../../../types';
import type { PersonalHeadlineNetWorthResult } from '../../../services/personalNetWorth';
import type { DashboardKpiSnapshot } from '../../../services/dashboardKpiSnapshot';
import type { WealthSummaryReportModel } from '../../../services/wealthSummaryReportModel';
import type { HeadlineInvestmentAllocationSlices } from '../../../services/headlineInvestmentAllocation';
import type { SimulatedPriceMap } from '../../../services/investmentPlatformCardMetrics';
import { useAnalyticsWorkspace } from '../../../context/AnalyticsWorkspaceContext';
import WealthChangeWaterfallChart from '../WealthChangeWaterfallChart';
import AnalyticsCrossFilterRibbon from '../AnalyticsCrossFilterRibbon';
import { buildWealthChangeWaterfallSteps } from '../../../services/wealthChangeWaterfallModel';
import { sumPersonalSukukPositionsSar } from '../../../services/sukuk/sukukExposure';
import { SummaryWealthAtlasSection } from '../wealthAnalyticsLazySections';
import { WealthHealthIndicatorsDeferredSection } from '../WealthAnalyticsDeferredSections';
import { SectionLoadingPlaceholder } from '../../shared/SectionLoadingPlaceholder';

type Props = {
  dir: 'rtl' | 'ltr';
  extendedReady: boolean;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  netWorthSar: number;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  investmentsTotalSar: number;
  personalInvestments: FinancialData['investments'];
  simulatedPrices: SimulatedPriceMap;
  sarPerUsd: number;
  data: FinancialData;
  goals: FinancialData['goals'];
  reportModel: WealthSummaryReportModel | null | undefined;
  formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  onWaterfallMarketClick?: () => void;
  onWaterfallCashflowClick?: () => void;
};

export const WealthZone: React.FC<Props> = (props) => {
  const { selectedCategory, setSelectedCategory } = useAnalyticsWorkspace();
  const waterfallSteps = buildWealthChangeWaterfallSteps({
    netWorthSar: props.netWorthSar,
    monthlyPnLSar: props.kpiSnapshot?.monthlyPnL ?? 0,
    buckets: props.headline.buckets,
  });

  const handleWaterfallStep = (stepName: string) => {
    if (stepName === 'Market') props.onWaterfallMarketClick?.();
    else if (stepName === 'Cashflow') props.onWaterfallCashflowClick?.();
  };

  const directSukukSar = sumPersonalSukukPositionsSar(props.data, props.sarPerUsd);

  return (
    <div className="space-y-6">
      {selectedCategory && (
        <AnalyticsCrossFilterRibbon category={selectedCategory} onClear={() => setSelectedCategory(null)} />
      )}

      <WealthChangeWaterfallChart
        steps={waterfallSteps}
        formatCurrency={(n) => props.formatCurrencyString(n, { digits: 0 })}
        compact
        className="max-w-xl"
        onStepClick={handleWaterfallStep}
      />

      {props.extendedReady && props.reportModel ? (
        <WealthHealthIndicatorsDeferredSection
          metricsExtendedReady
          discipline={props.reportModel.discipline}
          liquidityRunway={props.reportModel.liquidityRunway}
          investmentAllocation={props.investmentAllocation}
          sarPerUsd={props.sarPerUsd}
          setActivePage={props.setActivePage}
        />
      ) : (
        <SectionLoadingPlaceholder labelKey="analyticsHealthLoading" minHeight="6rem" />
      )}
      {directSukukSar > 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
          <p className="font-semibold">Direct Sukuk positions</p>
          <p className="tabular-nums font-bold mt-1">{props.formatCurrencyString(directSukukSar, { digits: 0 })}</p>
          <p className="text-xs mt-1 opacity-90">Held outside broker holdings — included in headline investment total.</p>
          {props.setActivePage ? (
            <button type="button" className="text-xs font-semibold text-emerald-800 hover:underline mt-2" onClick={() => props.setActivePage!('Investments')}>
              Open Investments →
            </button>
          ) : null}
        </div>
      ) : null}
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
};

export default WealthZone;
