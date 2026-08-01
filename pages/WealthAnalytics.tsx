import React, { useContext, useEffect, useMemo, useState, Suspense, lazy } from 'react';
import PageLayout from '../components/PageLayout';
import PageLanguageToggle from '../components/PageLanguageToggle';
import { SectionLoadingPlaceholder } from '../components/shared/SectionLoadingPlaceholder';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useLiveQuotePrices } from '../hooks/useLiveQuotePrices';
import { usePortfolioPeriodPnLSnapshot } from '../hooks/usePortfolioPeriodPnLSnapshot';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { usePrivacyMask } from '../context/PrivacyContext';
import { useLanguage } from '../context/LanguageContext';
import { useDashboardReconciliationPrefs } from '../hooks/useDashboardReconciliationPrefs';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import CollapsibleSection from '../components/CollapsibleSection';
import { QuotesAsOfBadge } from '../components/analytics/QuotesAsOfBadge';
import { WealthAnalyticsExportMenuSection, WealthAnalyticsDetailsSectionLazy } from '../components/analytics/wealthAnalyticsLazySections';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { usePageDeferredData } from '../context/PageDeferredDataContext';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import WealthAnalyticsZoneTabs from '../components/analytics/WealthAnalyticsZoneTabs';
import AnalyticsPeriodScopeBar from '../components/analytics/AnalyticsPeriodScopeBar';
import AnalyticsVisitDeltaChips from '../components/analytics/AnalyticsVisitDeltaChips';
import { useAnalyticsWorkspace } from '../context/AnalyticsWorkspaceContext';
import { useSpendingCommandCenterModel } from '../hooks/useSpendingCommandCenterModel';
import { detectBudgetDrift } from '../services/budgetDrift';
const OverviewZone = lazy(() => import('../components/analytics/zones/OverviewZone'));
const WealthZone = lazy(() => import('../components/analytics/zones/WealthZone'));
const InvestmentsZone = lazy(() => import('../components/analytics/zones/InvestmentsZone'));
const CashSpendZone = lazy(() => import('../components/analytics/zones/CashSpendZone'));

function ZoneSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<SectionLoadingPlaceholder minHeight="16rem" labelKey="sectionLoading" />}>
      {children}
    </Suspense>
  );
}
import SalaryInvestmentSummaryCard from '../components/SalaryInvestmentSummaryCard';
import {
  buildVisitSnapshotFromModel,
  computeVisitDelta,
  loadAnalyticsVisitSnapshot,
  saveAnalyticsVisitSnapshot,
} from '../services/analyticsVisitSnapshot';
import type { Page } from '../types';

interface WealthAnalyticsProps {
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

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

  const liveQuotePrices = useLiveQuotePrices();
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
    simulatedPrices: kpiQuotePrices,
    salaryInvestment,
  } = useExtendedCanonicalMetrics();

  const personalTransactions = useMemo(() => getPersonalTransactions(engineData), [engineData]);
  const personalAccounts = useMemo(() => getPersonalAccounts(engineData), [engineData]);
  const personalInvestments = useMemo(() => getPersonalInvestments(engineData), [engineData]);
  const portfolioPeriodPnL = usePortfolioPeriodPnLSnapshot({
    data: showHydrateBanner ? null : data,
    portfolios: personalInvestments,
    accounts: personalAccounts,
    sarPerUsd,
    simulatedPrices: kpiQuotePrices,
    enabled: !showHydrateBanner && !!data && personalInvestments.length > 0,
  });
  const goals = data?.goals ?? [];
  const budgets = data?.budgets ?? [];
  const { wealthZone, periodPreset, scope, setWealthZone, setAnalysisStudioTab } = useAnalyticsWorkspace();
  const spendingEnabled = wealthZone === 'overview' || wealthZone === 'cash';
  const { model: spendingModel, ready: spendingReady } = useSpendingCommandCenterModel(
    engineData,
    sarPerUsd,
    scope,
    spendingEnabled,
    periodPreset,
  );
  const budgetDriftRows = useMemo(() => detectBudgetDrift(engineData ?? null, sarPerUsd), [engineData, sarPerUsd]);

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

  const visitDelta = useMemo(() => {
    const current = buildVisitSnapshotFromModel(netWorth ?? 0, spendingReady ? spendingModel : null);
    const prior = loadAnalyticsVisitSnapshot();
    return computeVisitDelta(prior, current);
  }, [netWorth, spendingModel, spendingReady]);

  useEffect(() => {
    if (!spendingReady) return;
    const snap = buildVisitSnapshotFromModel(netWorth ?? 0, spendingModel);
    const onLeave = () => saveAnalyticsVisitSnapshot(snap);
    window.addEventListener('visibilitychange', onLeave);
    return () => window.removeEventListener('visibilitychange', onLeave);
  }, [netWorth, spendingModel, spendingReady]);

  const exportAction =
    extendedReady && reportModel ? (
      <WealthAnalyticsExportMenuSection
        data={data}
        wealthSummaryPayload={reportModel.wealthSummaryReportPayload}
        headline={headline}
        kpiSnapshot={kpiSnapshot}
        sarPerUsd={sarPerUsd}
        simulatedPrices={kpiQuotePrices}
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
        <SalaryInvestmentSummaryCard
          model={salaryInvestment}
          loading={!extendedReady && !salaryInvestment}
          formatCurrencyString={formatCurrencyString}
          compact
          onOpenSettings={
            setActivePage
              ? () => (triggerPageAction ? triggerPageAction('Settings', 'focus-salary-investing') : setActivePage('Settings'))
              : undefined
          }
          onOpenInvestments={setActivePage ? () => setActivePage('Investments') : undefined}
          onOpenTransactions={() => {
            setActivePage?.('Transactions');
            triggerPageAction?.('Transactions', 'open-transaction-modal');
          }}
        />
        {showHydrateBanner && (
          <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" role="status">
            {t('syncingWorkspace')}
          </p>
        )}

        <AnalyticsPeriodScopeBar className="mb-1" />

        {visitDelta && (
          <AnalyticsVisitDeltaChips
            delta={visitDelta}
            formatCurrencyString={formatCurrencyString}
            setActivePage={setActivePage}
            onReviewNetWorth={() => setWealthZone('overview')}
            onReviewSpending={() => {
              setWealthZone('cash');
              setAnalysisStudioTab('command');
            }}
          />
        )}

        <div className="min-w-0 space-y-6">
            <WealthAnalyticsZoneTabs className="mb-2" />

            {wealthZone === 'overview' && (
              <ZoneSuspense>
              <OverviewZone
                netWorthDisplay={maskBalance(formatCurrencyString(netWorth ?? 0, { digits: 0 }))}
                netWorthSar={netWorth ?? 0}
                monthlyPnLDisplay={maskBalance(formatCurrencyString(kpiSnapshot?.monthlyPnL ?? 0, { digits: 0 }))}
                monthlyPnLPositive={(kpiSnapshot?.monthlyPnL ?? 0) >= 0}
                roiDisplay={`${((kpiSnapshot?.roi ?? 0) * 100).toFixed(1)}%`}
                roiPositive={(kpiSnapshot?.roi ?? 0) >= 0}
                headline={headline}
                kpiSnapshot={kpiSnapshot}
                data={data}
                showHydrateBanner={showHydrateBanner}
                extendedReady={extendedReady}
                reportModel={reportModel}
                investmentAllocation={investmentAllocation}
                sarPerUsd={sarPerUsd}
                simulatedPrices={kpiQuotePrices}
                investmentsTotalSar={investmentsTotalSar}
                getAvailableCashForAccount={getAvailableCashForAccount}
                quotesAsOfIso={quotesAsOfIso}
                quotesLive={isLive}
                spendingModel={spendingModel}
                spendingReady={spendingReady}
                formatCurrencyString={formatCurrencyString}
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                portfolioPeriodPnL={portfolioPeriodPnL}
                onWaterfallMarketClick={() => setWealthZone('investments')}
                onWaterfallCashflowClick={() => {
                  setActivePage?.('Transactions');
                  triggerPageAction?.('Transactions', 'open-ledger');
                }}
                visitDelta={visitDelta}
                budgetDriftRows={budgetDriftRows}
              />
              </ZoneSuspense>
            )}

            {wealthZone === 'wealth' && (
              <ZoneSuspense>
              <WealthZone
                dir={dir}
                extendedReady={extendedReady}
                headline={headline}
                kpiSnapshot={kpiSnapshot}
                netWorthSar={netWorth ?? 0}
                investmentAllocation={investmentAllocation}
                investmentsTotalSar={extendedReady ? investmentsTotalSar : headline.buckets.investments}
                personalInvestments={personalInvestments}
                simulatedPrices={liveQuotePrices}
                sarPerUsd={sarPerUsd}
                data={data}
                goals={goals}
                reportModel={reportModel}
                formatCurrencyString={formatCurrencyString}
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
                onWaterfallMarketClick={() => setWealthZone('investments')}
                onWaterfallCashflowClick={() => {
                  setActivePage?.('Transactions');
                  triggerPageAction?.('Transactions', 'open-ledger');
                }}
              />
              </ZoneSuspense>
            )}

            {wealthZone === 'investments' && (
              <ZoneSuspense>
              <InvestmentsZone
                data={data}
                personalInvestments={personalInvestments}
                personalAccounts={personalAccounts}
                sarPerUsd={sarPerUsd}
                kpiQuotePrices={kpiQuotePrices}
                liveQuotePrices={liveQuotePrices}
                monthStartDay={resolveMonthStartDayFromData(data)}
                getAvailableCashForAccount={getAvailableCashForAccount}
                setActivePage={setActivePage}
                goals={goals}
                holdingsPortfolioId={holdingsPortfolioId}
                onHoldingsPortfolioChange={setHoldingsPortfolioId}
                portfoliosWithHoldings={portfoliosWithHoldings}
                portfolioPeriodPnL={portfolioPeriodPnL}
                t={t}
              />
              </ZoneSuspense>
            )}

            {wealthZone === 'cash' && (
              <ZoneSuspense>
              <CashSpendZone
                data={data}
                personalTransactions={personalTransactions}
                personalAccounts={personalAccounts}
                budgets={budgets}
                goals={goals}
                sarPerUsd={sarPerUsd}
                liquidCashSar={liquidCashSar}
                investmentsTotalSar={extendedReady ? investmentsTotalSar : headline.buckets.investments}
                spendingModel={spendingModel}
                spendingReady={spendingReady}
                setActivePage={setActivePage}
                triggerPageAction={triggerPageAction}
              />
              </ZoneSuspense>
            )}
        </div>

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
