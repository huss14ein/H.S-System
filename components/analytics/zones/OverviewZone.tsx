import React from 'react';
import type { FinancialData, Page } from '../../../types';
import type { PersonalHeadlineNetWorthResult } from '../../../services/personalNetWorth';
import type { DashboardKpiSnapshot } from '../../../services/dashboardKpiSnapshot';
import type { WealthSummaryReportModel } from '../../../services/wealthSummaryReportModel';
import type { HeadlineInvestmentAllocationSlices } from '../../../services/headlineInvestmentAllocation';
import type { ExpenseBudgetAnalysisModel } from '../../../services/expenseBudgetAnalysisModel';
import type { SimulatedPriceMap } from '../../../services/investmentPlatformCardMetrics';
import { useEmergencyFund } from '../../../hooks/useEmergencyFund';
import { useOpenMetricPassport } from '../../../hooks/useOpenMetricPassport';
import { buildWealthAnalyticsReportModel } from '../../../services/wealthAnalyticsReportModel';
import type { VisitDelta } from '../../../services/analyticsVisitSnapshot';
import type { BudgetDriftRow } from '../../../services/budgetDrift';
import { useAnalyticsWorkspace } from '../../../context/AnalyticsWorkspaceContext';
import AnalyticsInsightRail from '../AnalyticsInsightRail';
import { WealthAnalyticsHero } from '../WealthAnalyticsHero';
import WealthPulseRing from '../WealthPulseRing';
import WealthChangeWaterfallChart from '../WealthChangeWaterfallChart';
import AnalyticsCrossFilterRibbon from '../AnalyticsCrossFilterRibbon';
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
  roiStatusLabel?: string;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  data: FinancialData | null | undefined;
  showHydrateBanner: boolean;
  extendedReady: boolean;
  reportModel: WealthSummaryReportModel | null | undefined;
  investmentAllocation: HeadlineInvestmentAllocationSlices;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  investmentsTotalSar: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  quotesAsOfIso?: string | null;
  quotesLive?: boolean;
  spendingModel: ExpenseBudgetAnalysisModel | null;
  spendingReady: boolean;
  formatCurrencyString: (n: number, opts?: { digits?: number }) => string;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  portfolioPeriodPnL: import('../../../hooks/usePortfolioPeriodPnLSnapshot').PortfolioPeriodPnLSnapshot;
  onWaterfallMarketClick?: () => void;
  onWaterfallCashflowClick?: () => void;
  visitDelta?: VisitDelta | null;
  budgetDriftRows?: BudgetDriftRow[];
};

export const OverviewZone: React.FC<Props> = ({
  netWorthDisplay,
  netWorthSar,
  monthlyPnLDisplay,
  monthlyPnLPositive,
  roiDisplay,
  roiPositive,
  roiStatusLabel,
  headline,
  kpiSnapshot,
  data,
  showHydrateBanner,
  extendedReady,
  reportModel,
  investmentAllocation,
  sarPerUsd,
  simulatedPrices,
  investmentsTotalSar,
  getAvailableCashForAccount,
  quotesAsOfIso,
  quotesLive,
  spendingModel,
  spendingReady,
  formatCurrencyString,
  setActivePage,
  triggerPageAction,
  portfolioPeriodPnL,
  onWaterfallMarketClick,
  onWaterfallCashflowClick,
  visitDelta,
  budgetDriftRows = [],
}) => {
  const { selectedCategory, setSelectedCategory } = useAnalyticsWorkspace();
  const emergencyFund = useEmergencyFund(data ?? null);
  const exportModel = React.useMemo(() => {
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

  const handleWaterfallStep = (stepName: string) => {
    if (stepName === 'Market') onWaterfallMarketClick?.();
    else if (stepName === 'Cashflow') onWaterfallCashflowClick?.();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 items-start">
        <div className="min-w-0 space-y-6">
      {selectedCategory && (
        <AnalyticsCrossFilterRibbon category={selectedCategory} onClear={() => setSelectedCategory(null)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <WealthAnalyticsHero
          netWorthDisplay={netWorthDisplay}
          monthlyPnLDisplay={monthlyPnLDisplay}
          monthlyPnLPositive={monthlyPnLPositive}
          weeklyPnLDisplay={portfolioPeriodPnL.ready ? formatCurrencyString(portfolioPeriodPnL.weeklyTotalSar, { digits: 0 }) : '…'}
          weeklyPnLPositive={(portfolioPeriodPnL.weeklyTotalSar ?? 0) >= 0}
          roiDisplay={roiDisplay}
          roiPositive={roiPositive}
          roiStatusLabel={roiStatusLabel}
          onExplainMonthlyPnL={() => openPassport('monthlyPnL')}
          onExplainWeeklyPnL={() => openPassport('weeklyPnL')}
          onExplainInvestmentRoi={() => openPassport('investmentRoi')}
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
        onStepClick={handleWaterfallStep}
      />
      <WealthAnalyticsExecutiveKpiSection
        headline={headline}
        kpiSnapshot={kpiSnapshot}
        data={data}
        showHydrateBanner={showHydrateBanner}
        portfolioPeriodPnL={portfolioPeriodPnL}
        reportModel={reportModel}
        sarPerUsd={sarPerUsd}
        simulatedPrices={simulatedPrices}
        investmentsTotalSar={investmentsTotalSar}
        getAvailableCashForAccount={getAvailableCashForAccount}
        quotesAsOfIso={quotesAsOfIso}
        quotesLive={quotesLive}
      />
      {extendedReady && reportModel ? (
        <WealthHealthIndicatorsDeferredSection
          metricsExtendedReady
          discipline={reportModel.discipline}
          liquidityRunway={reportModel.liquidityRunway}
          investmentAllocation={investmentAllocation}
          sarPerUsd={sarPerUsd}
          setActivePage={setActivePage}
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

        {(spendingReady || visitDelta) && (
          <AnalyticsInsightRail
            model={spendingReady ? spendingModel : null}
            driftRows={budgetDriftRows}
            visitDelta={visitDelta}
            setActivePage={setActivePage}
            triggerPageAction={triggerPageAction}
            className="xl:sticky xl:top-4"
          />
        )}
      </div>
    </div>
  );
};

export default OverviewZone;
