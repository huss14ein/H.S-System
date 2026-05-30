import React, { useContext, useMemo } from 'react';
import PageLayout from '../components/PageLayout';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useCanonicalFinancialMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { usePrivacyMask } from '../context/PrivacyContext';
import { useLanguage } from '../context/LanguageContext';
import { useEmergencyFund } from '../hooks/useEmergencyFund';
import { useFinancialEnhancementInsights } from '../hooks/useFinancialEnhancementInsights';
import { useDashboardReconciliationPrefs } from '../hooks/useDashboardReconciliationPrefs';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import CollapsibleSection from '../components/CollapsibleSection';
import EnhancementInsightStrip from '../components/EnhancementInsightStrip';
import AIFeed from '../components/AIFeed';
import { ExecutiveKpiGrid } from '../components/analytics/ExecutiveKpiGrid';
import { WealthHealthIndicators } from '../components/analytics/WealthHealthIndicators';
import { WealthAnalyticsExportMenu } from '../components/analytics/WealthAnalyticsExportMenu';
import { DashboardOperationsCockpit } from '../components/dashboard/DashboardOperationsCockpit';
import { SummaryWealthAtlas } from '../components/dashboard/SummaryWealthAtlas';
import { WealthAnalyticsSummaryPanels } from '../components/analytics/WealthAnalyticsSummaryPanels';
import { PortfolioHoldingsGrid } from '../components/dashboard/PortfolioHoldingsGrid';
import { PortfolioPeriodPnLPanel } from '../components/dashboard/PortfolioPeriodPnLPanel';
import { CostAveragingCalculator } from '../components/dashboard/CostAveragingCalculator';
import { Goals2030Timeline } from '../components/dashboard/Goals2030Timeline';
import { AIExecutiveSummary } from '../components/dashboard/AIExecutiveSummary';
import MultiStockAnalysisPanel from '../components/investments/MultiStockAnalysisPanel';
import { DeferredMount } from '../components/dashboard/DeferredMount';
import { DashboardSectionHeader } from '../components/dashboard/DashboardSectionHeader';
import { getPersonalAccounts, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { listNetWorthSnapshots } from '../services/netWorthSnapshot';
import { attributeNetWorthWithFlows } from '../services/portfolioAttribution';
import { personalNetCashflowBetween } from '../services/netWorthPeriodFlows';
import { generateNextBestActions } from '../services/nextBestActionEngine';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { reconcileDashboardVsSummaryKpis } from '../services/kpiReconciliation';
import {
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
} from '../services/portfolioPeriodPnL';
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
        sarPerUsd,
        simulatedPrices,
    } = useCanonicalFinancialMetrics();
    const { strictReconciliationMode } = useDashboardReconciliationPrefs(auth?.user?.id);
    const enhancementInsights = useFinancialEnhancementInsights(emergencyFund.monthsCovered);
    const capitalDeployment = enhancementInsights.capitalDeployment;

    const personalTransactions = useMemo(() => getPersonalTransactions(data), [data]);
    const personalAccounts = useMemo(() => getPersonalAccounts(data), [data]);
    const personalInvestments = useMemo(() => getPersonalInvestments(data), [data]);
    const goals = data?.goals ?? [];
    const budgets = data?.budgets ?? [];

    const quotesAsOfIso = useMemo(() => {
        const stamps = Object.values(symbolQuoteUpdatedAt).filter(Boolean);
        if (!stamps.length) return null;
        return stamps.reduce((a, b) => (a > b ? a : b));
    }, [symbolQuoteUpdatedAt]);

    const kpiSummary = useMemo(
        () => ({
            netWorth: kpiSnapshot?.netWorth ?? headline.netWorth ?? 0,
            monthlyPnL: kpiSnapshot?.monthlyPnL ?? 0,
            budgetVariance: kpiSnapshot?.budgetVariance ?? 0,
            roi: kpiSnapshot?.roi ?? 0,
        }),
        [kpiSnapshot, headline.netWorth],
    );

    const nextBestActions = useMemo(() => {
        const salaryCov = salaryToExpenseCoverage(personalTransactions, 6);
        const goalAlerts = goals.map((g) => ({
            goalId: g.id,
            name: g.name,
            allocPct: Number(g.savingsAllocationPercent) || 0,
        }));
        return generateNextBestActions({
            emergencyFundMonths: emergencyFund.monthsCovered,
            runwayMonths: emergencyFund.monthsCovered,
            goalAlerts,
            salaryCoverageRatio: salaryCov?.ratio ?? undefined,
            nwSnapshotCount: listNetWorthSnapshots().length,
        });
    }, [personalTransactions, goals, emergencyFund.monthsCovered]);

    const kpiReconciliation = useMemo(() => {
        if (!strictReconciliationMode || !data || !getAvailableCashForAccount || !reportModel) return null;
        return reconcileDashboardVsSummaryKpis({
            dashboard: {
                netWorth: Number(kpiSummary.netWorth ?? 0),
                monthlyPnL: Number(kpiSummary.monthlyPnL ?? 0),
                budgetVariance: Number(kpiSummary.budgetVariance ?? 0),
                roi: Number(kpiSummary.roi ?? 0),
                emergencyFundMonths: Number(emergencyFund.monthsCovered ?? 0),
            },
            summaryMetrics: reportModel.financialMetricsWithEf,
            summaryMonthlyExtras: {
                budgetVariance: kpiSnapshot?.budgetVariance ?? 0,
                roi: kpiSnapshot?.roi ?? 0,
            },
        });
    }, [
        strictReconciliationMode,
        data,
        getAvailableCashForAccount,
        reportModel,
        kpiSummary,
        kpiSnapshot,
        emergencyFund.monthsCovered,
    ]);

    const nwSnapshotInsight = useMemo(() => {
        const snaps = listNetWorthSnapshots();
        if (snaps.length < 2) return { snaps, attr: null };
        const a = snaps[1];
        const b = snaps[0];
        const flow = personalNetCashflowBetween(personalTransactions, a.at, b.at);
        return {
            snaps,
            attr: attributeNetWorthWithFlows({
                startNw: a.netWorth,
                endNw: b.netWorth,
                externalCashflow: flow,
            }),
        };
    }, [personalTransactions]);

    const portfolioPnL = useMemo(() => {
        if (!data || !getAvailableCashForAccount) {
            return { weeklyTotalSar: 0, weeklySparkline: [] as number[] };
        }
        const monthStartDay = resolveMonthStartDayFromData(data);
        const summary = computePortfolioPeriodPnLSummary({
            data,
            portfolios: personalInvestments,
            accounts: personalAccounts,
            sarPerUsd,
            simulatedPrices,
            monthStartDay,
            getAvailableCashForAccount,
        });
        const daily = computePortfolioPnLDailySeries({
            data,
            portfolios: personalInvestments,
            accounts: personalAccounts,
            sarPerUsd,
            simulatedPrices,
            monthStartDay,
            getAvailableCashForAccount,
            locale: dir === 'rtl' ? 'ar-SA' : 'en-US',
        });
        return {
            weeklyTotalSar: summary.weeklyTotalSar,
            weeklySparkline: daily.weekly.map((p) => p.cumulativeSar),
        };
    }, [data, personalInvestments, personalAccounts, sarPerUsd, simulatedPrices, getAvailableCashForAccount, dir]);

    if (showHydrateBanner || !reportModel || !data) {
        return (
            <PageLayout title="Wealth Analytics" description={t('executiveKpiGridSubtitle')}>
                <p className="text-sm text-slate-600" role="status">
                    Loading analytics…
                </p>
            </PageLayout>
        );
    }

    const exportAction = (
        <WealthAnalyticsExportMenu
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
    );

    return (
        <PageLayout
            title="Wealth Analytics"
            description={`${t('executiveKpiGridSubtitle')} ${maskBalance(formatCurrencyString(headline.netWorth ?? 0, { digits: 0 }))} SAR.`}
            action={exportAction}
        >
            <div dir={dir} className="flex flex-col gap-6 min-w-0">
                <ExecutiveKpiGrid
                    headline={headline}
                    kpiSnapshot={kpiSnapshot}
                    emergencyFundMonths={emergencyFund.monthsCovered}
                    emergencyFundTargetSar={emergencyFund.targetAmount}
                    weeklyPnLSar={portfolioPnL.weeklyTotalSar}
                    weeklyPnLSparkline={portfolioPnL.weeklySparkline}
                />

                <WealthHealthIndicators
                    discipline={reportModel.discipline}
                    liquidityRunway={reportModel.liquidityRunway}
                    investmentAllocation={investmentAllocation}
                    budgetDriftTopCategory={enhancementInsights.budgetDrift[0]?.category}
                    budgetDriftPct={enhancementInsights.budgetDrift[0]?.driftPct}
                />

                <section className="min-w-0" aria-label="Portfolio period performance">
                    <DeferredMount minHeight="10rem">
                        <PortfolioPeriodPnLPanel
                            data={data}
                            portfolios={personalInvestments}
                            accounts={personalAccounts}
                            sarPerUsd={sarPerUsd}
                            simulatedPrices={simulatedPrices}
                            monthStartDay={resolveMonthStartDayFromData(data)}
                            getAvailableCashForAccount={getAvailableCashForAccount}
                            setActivePage={setActivePage}
                        />
                    </DeferredMount>
                </section>

                <section className="min-w-0" aria-label="Wealth atlas">
                    <SummaryWealthAtlas
                        dir={dir}
                        buckets={headline.buckets}
                        netWorthSar={headline.netWorth ?? 0}
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
                </section>

                <section className="min-w-0" aria-label="Operations cockpit">
                    <DashboardOperationsCockpit
                        data={data}
                        personalTransactions={personalTransactions}
                        personalAccounts={personalAccounts}
                        budgets={budgets}
                        goals={goals}
                        sarPerUsd={sarPerUsd}
                        liquidCashSar={kpiSnapshot?.liquidCashSar ?? 0}
                        investmentsTotalSar={investmentsTotalSar}
                        showLanguageToggle={false}
                    />
                </section>

                <section className="min-w-0" aria-label="Holdings and tools">
                    <DashboardSectionHeader
                        titleKey="analyticsHoldingsTitle"
                        subtitleKey="analyticsHoldingsSubtitle"
                        showLanguageToggle={false}
                    />
                    <DeferredMount minHeight="12rem">
                        <PortfolioHoldingsGrid
                            portfolios={personalInvestments}
                            simulatedPrices={simulatedPrices}
                            sarPerUsd={sarPerUsd}
                        />
                    </DeferredMount>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch mt-4">
                        <CostAveragingCalculator portfolios={personalInvestments} />
                        <Goals2030Timeline
                            data={data}
                            goals={goals}
                            sarPerUsd={sarPerUsd}
                            onOpenGoals={setActivePage ? () => setActivePage('Goals') : undefined}
                        />
                    </div>
                </section>

                <CollapsibleSection
                    title={t('analyticsDetailsTitle')}
                    summary={t('analyticsDetailsSummary')}
                    defaultExpanded={false}
                    className="mb-0"
                >
                    <div className="space-y-4 pt-2">
                        <WealthAnalyticsSummaryPanels
                            reportModel={reportModel}
                            maskBalance={maskBalance}
                            formatCurrencyString={formatCurrencyString}
                            nwSnapshotInsight={nwSnapshotInsight}
                            setActivePage={setActivePage}
                            triggerPageAction={triggerPageAction}
                        />

                        {strictReconciliationMode && kpiReconciliation && !kpiReconciliation.ok && (
                            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm" role="alert">
                                <p className="font-semibold text-rose-950">KPI mismatch (strict mode)</p>
                                <ul className="mt-2 space-y-1 text-rose-900 list-disc pl-4">
                                    {kpiReconciliation.rows
                                        .filter((r) => !r.withinThreshold)
                                        .map((r) => (
                                            <li key={r.key}>
                                                {r.label}: Dashboard {r.dashboardValue.toFixed(2)} vs Summary {r.summaryValue.toFixed(2)}
                                            </li>
                                        ))}
                                </ul>
                            </div>
                        )}

                        {nextBestActions.length > 0 && (
                            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                                <h3 className="text-sm font-semibold text-slate-800 mb-2">Suggested actions</h3>
                                <ul className="space-y-2 text-sm">
                                    {nextBestActions.slice(0, 5).map((action) => (
                                        <li key={action.id} className="flex flex-wrap gap-2">
                                            <span className="text-slate-700 flex-1">{action.title}</span>
                                            {action.link && setActivePage && (
                                                <button
                                                    type="button"
                                                    onClick={() => setActivePage(action.link as Page)}
                                                    className="text-primary font-medium hover:underline"
                                                >
                                                    {action.linkLabel ?? action.link} →
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <EnhancementInsightStrip
                            goalConflicts={enhancementInsights.goalConflicts}
                            budgetDrift={enhancementInsights.budgetDrift.slice(0, 3)}
                            lifestyleHits={enhancementInsights.lifestyleHits}
                        />

                        {capitalDeployment && (
                            <section className="rounded-xl border border-slate-200 overflow-hidden text-sm">
                                <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-xs uppercase tracking-wide">
                                    Can I invest? — {capitalDeployment.canInvest ? 'Ready' : 'Gated'}
                                </div>
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-500">Investable surplus</p>
                                        <p className="font-bold tabular-nums">
                                            {formatCurrencyString(capitalDeployment.investableSurplusSar, { digits: 0 })}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-500">Runway</p>
                                        <p className="font-bold tabular-nums">{capitalDeployment.runwayMonths.toFixed(1)} mo</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase text-slate-500">Free cash flow</p>
                                        <p className="font-bold tabular-nums">
                                            {formatCurrencyString(capitalDeployment.monthlyFreeCashFlowSar, { digits: 0 })}
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {reportModel.discipline && (
                            <section className="rounded-xl border border-slate-200 p-4">
                                <h3 className="text-xs font-bold uppercase text-slate-600 mb-2">Budget discipline</h3>
                                <p className="text-2xl font-bold tabular-nums mb-1">
                                    {reportModel.discipline.score}
                                    <span className="text-sm font-normal text-slate-500">/100</span>
                                </p>
                                {reportModel.discipline.label && (
                                    <p className="text-sm text-slate-600">Rating: {reportModel.discipline.label}</p>
                                )}
                            </section>
                        )}

                        <CollapsibleSection title="AI executive summary" summary="On-demand narrative" defaultExpanded={false} className="mb-0">
                            <AIExecutiveSummary />
                        </CollapsibleSection>

                        <CollapsibleSection title="AI insights feed" summary="Automated signals" defaultExpanded={false} className="mb-0">
                            <AIFeed />
                        </CollapsibleSection>

                        <CollapsibleSection title="Multi-stock AI analysis" summary="Arabic/English batch research" defaultExpanded={false} className="mb-0">
                            <MultiStockAnalysisPanel compact />
                        </CollapsibleSection>
                    </div>
                </CollapsibleSection>
            </div>
        </PageLayout>
    );
};

export default WealthAnalytics;
