import React, { useContext, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import PageLanguageToggle from '../components/PageLanguageToggle';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { usePrivacyMask } from '../context/PrivacyContext';
import { useLanguage } from '../context/LanguageContext';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { useDashboardReconciliationPrefs } from '../hooks/useDashboardReconciliationPrefs';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { useEnhancementSignals } from '../hooks/useEnhancementSignals';
import { useExecutiveKpiSparklines } from '../hooks/useExecutiveKpiSparklines';
import CollapsibleSection from '../components/CollapsibleSection';
import { ExecutiveKpiGrid } from '../components/analytics/ExecutiveKpiGrid';
import { WealthAnalyticsHero } from '../components/analytics/WealthAnalyticsHero';
import { QuotesAsOfBadge } from '../components/analytics/QuotesAsOfBadge';
import { DeferredMount } from '../components/dashboard/DeferredMount';
import { DashboardSectionHeader } from '../components/dashboard/DashboardSectionHeader';
import {
    WealthHealthIndicatorsSection,
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
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { usePortfolioPeriodPnLSnapshot } from '../hooks/usePortfolioPeriodPnLSnapshot';
import type { Page } from '../types';

interface WealthAnalyticsProps {
    setActivePage?: (page: Page) => void;
    triggerPageAction?: (page: Page, action: string) => void;
}

const WealthAnalytics: React.FC<WealthAnalyticsProps> = ({ setActivePage, triggerPageAction }) => {
    const { data, getAvailableCashForAccount, showHydrateBanner } = useContext(DataContext)!;
    const auth = useContext(AuthContext);
    const { formatCurrencyString } = useFormatCurrency();
    const { maskBalance } = usePrivacyMask();
    const { dir, t } = useLanguage();
    const emergencyFund = useEmergencyFund(data);
    const { isLive, symbolQuoteUpdatedAt } = useMarketQuoteMeta();
    const {
        wealthSummary: reportModel,
        kpiSnapshot,
        headline,
        investmentAllocation,
        investmentsTotalSar,
        netWorth,
        liquidCashSar,
        sarPerUsd,
        simulatedPrices,
    } = useCanonicalFinancialMetrics();
    const { budgetDrift } = useEnhancementSignals(sarPerUsd);
    const { strictReconciliationMode } = useDashboardReconciliationPrefs(auth?.user?.id);
    const netWorthSparkline = useExecutiveKpiSparklines(!showHydrateBanner);

    const personalTransactions = useMemo(() => getPersonalTransactions(data), [data]);
    const personalAccounts = useMemo(() => getPersonalAccounts(data), [data]);
    const personalInvestments = useMemo(() => getPersonalInvestments(data), [data]);
    const goals = data?.goals ?? [];
    const budgets = data?.budgets ?? [];

    const portfoliosWithHoldings = useMemo(
        () => personalInvestments.filter((p) => (p.holdings?.length ?? 0) > 0),
        [personalInvestments],
    );
    const [holdingsPortfolioId, setHoldingsPortfolioId] = useState<string>('');
    useEffect(() => {
        if (
            holdingsPortfolioId &&
            portfoliosWithHoldings.some((p) => p.id === holdingsPortfolioId)
        ) {
            return;
        }
        setHoldingsPortfolioId(portfoliosWithHoldings[0]?.id ?? '');
    }, [portfoliosWithHoldings, holdingsPortfolioId]);

    const quotesAsOfIso = useMemo(() => {
        const stamps = Object.values(symbolQuoteUpdatedAt).filter(Boolean);
        if (!stamps.length) return null;
        return stamps.reduce((a, b) => (a > b ? a : b));
    }, [symbolQuoteUpdatedAt]);

    const portfolioPnL = usePortfolioPeriodPnLSnapshot({
        data: showHydrateBanner ? null : data,
        portfolios: personalInvestments,
        accounts: personalAccounts,
        sarPerUsd,
        simulatedPrices,
        locale: dir === 'rtl' ? 'ar-SA' : 'en-US',
    });

    const exportAction = reportModel ? (
        <WealthAnalyticsExportMenuSection
            data={data}
            wealthSummaryPayload={reportModel.wealthSummaryReportPayload}
            headline={headline}
            kpiSnapshot={kpiSnapshot}
            emergencyFund={emergencyFund}
            sarPerUsd={sarPerUsd}
            simulatedPrices={simulatedPrices}
            investmentsTotalSar={investmentsTotalSar}
            getAvailableCashForAccount={getAvailableCashForAccount}
            quotesAsOfIso={quotesAsOfIso}
            quotesLive={isLive}
        />
    ) : (
        <div className="flex flex-wrap items-center gap-2 justify-end">
            <PageLanguageToggle />
            <QuotesAsOfBadge />
        </div>
    );

    return (
        <PageLayout
            title="Wealth Analytics"
            description={`${t('executiveKpiGridSubtitle')} ${maskBalance(formatCurrencyString(netWorth ?? 0, { digits: 0 }))} SAR.`}
            action={exportAction}
        >
            <div dir={dir} className="flex flex-col gap-6 min-w-0">
                {showHydrateBanner && (
                    <p className="text-sm text-slate-600" role="status">
                        Syncing workspace…
                    </p>
                )}

                <WealthAnalyticsHero
                    netWorthDisplay={maskBalance(formatCurrencyString(netWorth ?? 0, { digits: 0 }))}
                    monthlyPnLDisplay={maskBalance(formatCurrencyString(kpiSnapshot?.monthlyPnL ?? 0, { digits: 0 }))}
                    monthlyPnLPositive={(kpiSnapshot?.monthlyPnL ?? 0) >= 0}
                    roiDisplay={`${((kpiSnapshot?.roi ?? 0) * 100).toFixed(1)}%`}
                    roiPositive={(kpiSnapshot?.roi ?? 0) >= 0}
                />

                <ExecutiveKpiGrid
                    headline={headline}
                    kpiSnapshot={kpiSnapshot}
                    emergencyFundMonths={emergencyFund.monthsCovered}
                    emergencyFundTargetSar={emergencyFund.targetAmount}
                    weeklyPnLSar={portfolioPnL.weeklyTotalSar}
                    weeklyPnLSparkline={portfolioPnL.weeklySparkline}
                    netWorthSparklineOverride={netWorthSparkline}
                />

                <DeferredMount minHeight="6rem" staggerIndex={0}>
                    <WealthHealthIndicatorsSection
                        discipline={reportModel?.discipline}
                        liquidityRunway={reportModel?.liquidityRunway}
                        investmentAllocation={investmentAllocation}
                        budgetDriftTopCategory={budgetDrift[0]?.category}
                        budgetDriftPct={budgetDrift[0]?.driftPct}
                    />
                </DeferredMount>

                <section className="min-w-0" aria-label="Portfolio period performance">
                    <DeferredMount minHeight="10rem" staggerIndex={1}>
                        <PortfolioPeriodPnLPanelSection
                            data={data}
                            portfolios={personalInvestments}
                            accounts={personalAccounts}
                            sarPerUsd={sarPerUsd}
                            simulatedPrices={simulatedPrices}
                            monthStartDay={resolveMonthStartDayFromData(data)}
                            getAvailableCashForAccount={getAvailableCashForAccount}
                            setActivePage={setActivePage}
                            precomputed={{
                                summary: portfolioPnL.summary,
                                dailySeries: portfolioPnL.dailySeries,
                                ready: portfolioPnL.ready,
                            }}
                        />
                    </DeferredMount>
                </section>

                <section className="min-w-0" aria-label="Wealth atlas">
                    <DeferredMount minHeight="14rem" staggerIndex={2}>
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
                    </DeferredMount>
                </section>

                <section className="min-w-0" aria-label="Operations cockpit">
                    <DeferredMount minHeight="16rem" staggerIndex={3}>
                        <DashboardOperationsCockpitSection
                            data={data}
                            personalTransactions={personalTransactions}
                            personalAccounts={personalAccounts}
                            budgets={budgets}
                            goals={goals}
                            sarPerUsd={sarPerUsd}
                            liquidCashSar={liquidCashSar}
                            investmentsTotalSar={investmentsTotalSar}
                            showLanguageToggle={false}
                        />
                    </DeferredMount>
                </section>

                <section className="min-w-0" aria-label="Holdings and tools">
                    <DashboardSectionHeader
                        titleKey="analyticsHoldingsTitle"
                        subtitleKey="analyticsHoldingsSubtitle"
                        showLanguageToggle={false}
                    />
                    {portfoliosWithHoldings.length > 0 && (
                        <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
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
                    <DeferredMount minHeight="12rem" staggerIndex={4}>
                        <PortfolioHoldingsGridSection
                            portfolios={personalInvestments}
                            simulatedPrices={simulatedPrices}
                            sarPerUsd={sarPerUsd}
                            portfolioId={holdingsPortfolioId || null}
                        />
                    </DeferredMount>
                    <DeferredMount minHeight="12rem" staggerIndex={5}>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch mt-4">
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
                        reportModel={reportModel}
                        personalTransactions={personalTransactions}
                        goals={goals}
                        emergencyFundMonths={emergencyFund.monthsCovered}
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
