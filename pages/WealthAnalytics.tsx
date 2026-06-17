import React, { useContext, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import PageLanguageToggle from '../components/PageLanguageToggle';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useLiveQuotePrices } from '../hooks/useLiveQuotePrices';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { usePrivacyMask } from '../context/PrivacyContext';
import { useLanguage } from '../context/LanguageContext';
import { useDashboardReconciliationPrefs } from '../hooks/useDashboardReconciliationPrefs';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import CollapsibleSection from '../components/CollapsibleSection';
import { WealthAnalyticsHero } from '../components/analytics/WealthAnalyticsHero';
import { QuotesAsOfBadge } from '../components/analytics/QuotesAsOfBadge';
import { DeferredMount } from '../components/dashboard/DeferredMount';
import { DashboardSectionHeader } from '../components/dashboard/DashboardSectionHeader';
import { SectionLoadingPlaceholder } from '../components/shared/SectionLoadingPlaceholder';
import {
  WealthHealthIndicatorsDeferredSection,
  WealthAnalyticsExecutiveKpiSection,
} from '../components/analytics/WealthAnalyticsDeferredSections';
import {
  SummaryWealthAtlasSection,
  DashboardOperationsCockpitSection,
  PortfolioPeriodPnLPanelSection,
  PortfolioHoldingsGridSection,
  CostAveragingCalculatorSection,
  Goals2030TimelineSection,
  WealthAnalyticsExportMenuSection,
  WealthAnalyticsDetailsSectionLazy,
} from '../components/analytics/wealthAnalyticsLazySections';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { usePageDeferredData } from '../context/PageDeferredDataContext';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import type { Page } from '../types';

interface WealthAnalyticsProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

const BELOW_FOLD_ROOT_MARGIN = '320px';

const WealthAnalytics: React.FC<WealthAnalyticsProps> = ({ setActivePage, triggerPageAction }) => {
  const { data, getAvailableCashForAccount, showHydrateBanner } = useContext(DataContext)!;
  const { computeData } = usePageDeferredData();
  const engineData = computeData ?? data;
  const auth = useContext(AuthContext);
  const { formatCurrencyString } = useFormatCurrency();
  const { maskBalance } = usePrivacyMask();
  const { dir, t } = useLanguage();
  const { isLive, symbolQuoteUpdatedAt } = useMarketQuoteMeta();
  const { strictReconciliationMode } = useDashboardReconciliationPrefs(auth?.user?.id);

  const simulatedPrices = useLiveQuotePrices();
  const {
    headline,
    kpiSnapshot,
    netWorth,
    liquidCashSar,
    sarPerUsd,
    wealthSummary: reportModel,
    investmentAllocation,
    investmentsTotalSar,
    extendedReady,
  } = useExtendedCanonicalMetrics();

  const personalTransactions = useMemo(() => getPersonalTransactions(engineData), [engineData]);
  const personalAccounts = useMemo(() => getPersonalAccounts(engineData), [engineData]);
  const personalInvestments = useMemo(() => getPersonalInvestments(engineData), [engineData]);
  const goals = data?.goals ?? [];
  const budgets = data?.budgets ?? [];

  const portfoliosWithHoldings = useMemo(
    () => personalInvestments.filter((p) => (p.holdings?.length ?? 0) > 0),
    [personalInvestments],
  );
  const [holdingsPortfolioId, setHoldingsPortfolioId] = useState<string>('');
  useEffect(() => {
    if (holdingsPortfolioId && portfoliosWithHoldings.some((p) => p.id === holdingsPortfolioId)) {
      return;
    }
    setHoldingsPortfolioId(portfoliosWithHoldings[0]?.id ?? '');
  }, [portfoliosWithHoldings, holdingsPortfolioId]);

  const quotesAsOfIso = useMemo(() => {
    const stamps = Object.values(symbolQuoteUpdatedAt).filter(Boolean);
    if (!stamps.length) return null;
    return stamps.reduce((a, b) => (a > b ? a : b));
  }, [symbolQuoteUpdatedAt]);

  const exportAction =
    extendedReady && reportModel ? (
      <WealthAnalyticsExportMenuSection
        data={data}
        wealthSummaryPayload={reportModel.wealthSummaryReportPayload}
        headline={headline}
        kpiSnapshot={kpiSnapshot}
        sarPerUsd={sarPerUsd}
        simulatedPrices={simulatedPrices}
        investmentsTotalSar={investmentsTotalSar}
        getAvailableCashForAccount={getAvailableCashForAccount}
        quotesAsOfIso={quotesAsOfIso}
        quotesLive={isLive}
      />
    ) : (
      <div className="flex flex-wrap items-center gap-2 justify-end w-full">
        <PageLanguageToggle />
        <QuotesAsOfBadge />
      </div>
    );

  return (
    <PageLayout title="Wealth Analytics" action={exportAction}>
      <div dir={dir} className="flex flex-col gap-6 min-w-0 w-full">
        {showHydrateBanner && (
          <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" role="status">
            {t('syncingWorkspace')}
          </p>
        )}

        <WealthAnalyticsHero
          netWorthDisplay={maskBalance(formatCurrencyString(netWorth ?? 0, { digits: 0 }))}
          monthlyPnLDisplay={maskBalance(formatCurrencyString(kpiSnapshot?.monthlyPnL ?? 0, { digits: 0 }))}
          monthlyPnLPositive={(kpiSnapshot?.monthlyPnL ?? 0) >= 0}
          roiDisplay={`${((kpiSnapshot?.roi ?? 0) * 100).toFixed(1)}%`}
          roiPositive={(kpiSnapshot?.roi ?? 0) >= 0}
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

        <section className="min-w-0 w-full" aria-label="Portfolio period performance">
          <PortfolioPeriodPnLPanelSection
            data={data}
            portfolios={personalInvestments}
            accounts={personalAccounts}
            sarPerUsd={sarPerUsd}
            simulatedPrices={simulatedPrices}
            monthStartDay={resolveMonthStartDayFromData(data)}
            getAvailableCashForAccount={getAvailableCashForAccount}
            setActivePage={setActivePage}
          />
        </section>

        <section className="min-w-0 w-full" aria-label="Wealth atlas">
          {extendedReady ? (
            <SummaryWealthAtlasSection
              dir={dir}
              buckets={headline.buckets}
              netWorthSar={netWorth ?? 0}
              investmentAllocation={investmentAllocation}
              investmentsTotalSar={investmentsTotalSar}
              personalInvestments={personalInvestments}
              simulatedPrices={simulatedPrices}
              sarPerUsd={sarPerUsd}
              data={data}
              goals={goals}
              onOpenGoals={setActivePage ? () => setActivePage('Goals') : undefined}
              showLanguageToggle={false}
            />
          ) : (
            <SectionLoadingPlaceholder labelKey="analyticsAtlasLoading" minHeight="14rem" />
          )}
        </section>

        <section className="min-w-0 w-full" aria-label="Operations cockpit">
          <DeferredMount
            minHeight="16rem"
            staggerIndex={0}
            rootMargin={BELOW_FOLD_ROOT_MARGIN}
            loadingLabelKey="sectionLoading"
          >
            <DashboardOperationsCockpitSection
              data={data}
              personalTransactions={personalTransactions}
              personalAccounts={personalAccounts}
              budgets={budgets}
              goals={goals}
              sarPerUsd={sarPerUsd}
              liquidCashSar={liquidCashSar}
              investmentsTotalSar={extendedReady ? investmentsTotalSar : headline.buckets.investments}
              showLanguageToggle={false}
            />
          </DeferredMount>
        </section>

        <section className="min-w-0 w-full" aria-label="Holdings and tools">
          <DashboardSectionHeader
            titleKey="analyticsHoldingsTitle"
            subtitleKey="analyticsHoldingsSubtitle"
            showLanguageToggle={false}
          />
          {portfoliosWithHoldings.length > 0 && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label htmlFor="wealth-analytics-portfolio" className="text-sm font-medium text-slate-700 shrink-0">
                {t('portfolioLabel')}
              </label>
              <select
                id="wealth-analytics-portfolio"
                value={holdingsPortfolioId}
                onChange={(e) => setHoldingsPortfolioId(e.target.value)}
                className="input-base w-full sm:max-w-md"
                aria-label={t('portfolioLabel')}
              >
                {portfoliosWithHoldings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DeferredMount
            minHeight="12rem"
            staggerIndex={1}
            rootMargin={BELOW_FOLD_ROOT_MARGIN}
            loadingLabelKey="sectionLoading"
          >
            <div className="space-y-4">
              <PortfolioHoldingsGridSection
                portfolios={personalInvestments}
                simulatedPrices={simulatedPrices}
                sarPerUsd={sarPerUsd}
                portfolioId={holdingsPortfolioId || null}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                <CostAveragingCalculatorSection
                  portfolios={personalInvestments}
                  portfolioId={holdingsPortfolioId || null}
                />
                <Goals2030TimelineSection
                  data={data}
                  goals={goals}
                  sarPerUsd={sarPerUsd}
                  onOpenGoals={setActivePage ? () => setActivePage('Goals') : undefined}
                />
              </div>
            </div>
          </DeferredMount>
        </section>

        <CollapsibleSection
          title={t('analyticsDetailsTitle')}
          summary={t('analyticsDetailsSummary')}
          defaultExpanded={false}
          className="mb-0"
        >
          <WealthAnalyticsDetailsSectionLazy
            data={data}
            reportModel={extendedReady ? reportModel : null}
            personalTransactions={personalTransactions}
            goals={goals}
            strictReconciliationMode={strictReconciliationMode}
            kpiSnapshot={kpiSnapshot}
            sarPerUsd={sarPerUsd}
            setActivePage={setActivePage}
            triggerPageAction={triggerPageAction}
          />
        </CollapsibleSection>
      </div>
    </PageLayout>
  );
};

export default WealthAnalytics;
