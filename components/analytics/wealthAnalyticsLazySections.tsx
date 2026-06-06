import React, { Suspense, lazy, type ComponentProps } from 'react';
import type { FinancialData } from '../../types';
import type { PersonalHeadlineNetWorthResult } from '../../services/personalNetWorth';
import type { DashboardKpiSnapshot } from '../../services/dashboardKpiSnapshot';
import type { EmergencyFundMetrics } from '../../hooks/useEmergencyFund';
import type { SimulatedPriceMap } from '../../services/investmentPlatformCardMetrics';
import type { WealthSummaryReportInput } from '../../services/reportingEngine';

const sectionPulse = (minHeight: string) => (
  <div
    className="rounded-2xl border border-slate-200 bg-slate-50/70 animate-pulse"
    style={{ minHeight }}
    aria-hidden
  />
);

const LazyWealthHealthIndicators = lazy(() =>
  import('./WealthHealthIndicators').then((m) => ({ default: m.WealthHealthIndicators })),
);

const LazySummaryWealthAtlas = lazy(() =>
  import('../dashboard/SummaryWealthAtlas').then((m) => ({ default: m.SummaryWealthAtlas })),
);

const LazyDashboardOperationsCockpit = lazy(() =>
  import('../dashboard/DashboardOperationsCockpit').then((m) => ({ default: m.DashboardOperationsCockpit })),
);

const LazyWealthAnalyticsSummaryPanels = lazy(() =>
  import('./WealthAnalyticsSummaryPanels').then((m) => ({ default: m.WealthAnalyticsSummaryPanels })),
);

const LazyAIExecutiveSummary = lazy(() =>
  import('../dashboard/AIExecutiveSummary').then((m) => ({ default: m.AIExecutiveSummary })),
);

const LazyAIFeed = lazy(() => import('../AIFeed'));

const LazyMultiStockAnalysisPanel = lazy(() => import('../investments/MultiStockAnalysisPanel'));

const LazyPortfolioPeriodPnLPanel = lazy(() =>
  import('../dashboard/PortfolioPeriodPnLPanel').then((m) => ({ default: m.PortfolioPeriodPnLPanel })),
);

const LazyPortfolioHoldingsGrid = lazy(() =>
  import('../dashboard/PortfolioHoldingsGrid').then((m) => ({ default: m.PortfolioHoldingsGrid })),
);

const LazyCostAveragingCalculator = lazy(() =>
  import('../dashboard/CostAveragingCalculator').then((m) => ({ default: m.CostAveragingCalculator })),
);

const LazyGoals2030Timeline = lazy(() =>
  import('../dashboard/Goals2030Timeline').then((m) => ({ default: m.Goals2030Timeline })),
);

const LazyWealthAnalyticsExportMenu = lazy(() =>
  import('./WealthAnalyticsExportMenu').then((m) => ({ default: m.WealthAnalyticsExportMenu })),
);

const LazyWealthAnalyticsDetailsSection = lazy(() =>
  import('./WealthAnalyticsDetailsSection').then((m) => ({ default: m.WealthAnalyticsDetailsSection })),
);

export const WealthHealthIndicatorsSection: React.FC<
  ComponentProps<typeof LazyWealthHealthIndicators>
> = (props) => (
  <Suspense fallback={sectionPulse('6rem')}>
    <LazyWealthHealthIndicators {...props} />
  </Suspense>
);

export const SummaryWealthAtlasSection: React.FC<ComponentProps<typeof LazySummaryWealthAtlas>> = (props) => (
  <Suspense fallback={sectionPulse('14rem')}>
    <LazySummaryWealthAtlas {...props} />
  </Suspense>
);

export const DashboardOperationsCockpitSection: React.FC<
  ComponentProps<typeof LazyDashboardOperationsCockpit>
> = (props) => (
  <Suspense fallback={sectionPulse('16rem')}>
    <LazyDashboardOperationsCockpit {...props} />
  </Suspense>
);

export const WealthAnalyticsSummaryPanelsSection: React.FC<
  ComponentProps<typeof LazyWealthAnalyticsSummaryPanels>
> = (props) => (
  <Suspense fallback={sectionPulse('10rem')}>
    <LazyWealthAnalyticsSummaryPanels {...props} />
  </Suspense>
);

export const AIExecutiveSummarySection: React.FC = () => (
  <Suspense fallback={sectionPulse('8rem')}>
    <LazyAIExecutiveSummary />
  </Suspense>
);

export const AIFeedSection: React.FC = () => (
  <Suspense fallback={sectionPulse('8rem')}>
    <LazyAIFeed />
  </Suspense>
);

export const MultiStockAnalysisSection: React.FC<{ compact?: boolean }> = (props) => (
  <Suspense fallback={sectionPulse('8rem')}>
    <LazyMultiStockAnalysisPanel {...props} />
  </Suspense>
);

export const PortfolioPeriodPnLPanelSection: React.FC<
  ComponentProps<typeof LazyPortfolioPeriodPnLPanel>
> = (props) => (
  <Suspense fallback={sectionPulse('10rem')}>
    <LazyPortfolioPeriodPnLPanel {...props} />
  </Suspense>
);

export const PortfolioHoldingsGridSection: React.FC<
  ComponentProps<typeof LazyPortfolioHoldingsGrid>
> = (props) => (
  <Suspense fallback={sectionPulse('12rem')}>
    <LazyPortfolioHoldingsGrid {...props} />
  </Suspense>
);

export const CostAveragingCalculatorSection: React.FC<
  ComponentProps<typeof LazyCostAveragingCalculator>
> = (props) => (
  <Suspense fallback={sectionPulse('10rem')}>
    <LazyCostAveragingCalculator {...props} />
  </Suspense>
);

export const Goals2030TimelineSection: React.FC<ComponentProps<typeof LazyGoals2030Timeline>> = (props) => (
  <Suspense fallback={sectionPulse('10rem')}>
    <LazyGoals2030Timeline {...props} />
  </Suspense>
);

export const WealthAnalyticsExportMenuSection: React.FC<{
  data: FinancialData;
  wealthSummaryPayload: WealthSummaryReportInput;
  headline: PersonalHeadlineNetWorthResult;
  kpiSnapshot: DashboardKpiSnapshot | null | undefined;
  emergencyFund: EmergencyFundMetrics;
  sarPerUsd: number;
  simulatedPrices: SimulatedPriceMap;
  investmentsTotalSar: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR?: number; USD?: number } | null | undefined;
  quotesAsOfIso?: string | null;
  quotesLive?: boolean;
}> = (props) => (
  <Suspense fallback={<span className="inline-block h-9 w-24 rounded-lg bg-slate-100 animate-pulse" aria-hidden />}>
    <LazyWealthAnalyticsExportMenu {...props} />
  </Suspense>
);

export const WealthAnalyticsDetailsSectionLazy: React.FC<
  ComponentProps<typeof LazyWealthAnalyticsDetailsSection>
> = (props) => (
  <Suspense fallback={sectionPulse('12rem')}>
    <LazyWealthAnalyticsDetailsSection {...props} />
  </Suspense>
);
