import React, { useMemo, useContext, Suspense, lazy } from 'react';
import { DataContext } from '../context/DataContext';
import { BarChart, Bar, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import AiProxyUnavailableHint from '../components/AiProxyUnavailableHint';
import { useAI } from '../context/AiContext';
import PageLayout from '../components/PageLayout';
import PageActionsDropdown from '../components/PageActionsDropdown';
import { CHART_COLORS, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber } from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';
import type { Transaction, Page, Account } from '../types';
import {
    expenseTotalsByBudgetCategorySar,
    spendByMerchantSar,
    detectSalaryIncomeSar,
    subscriptionSpendMonthlySar,
    detectBnplMentionsSar,
    findRefundPairsSar,
} from '../services/transactionIntelligence';
import { salaryToExpenseCoverageSar } from '../services/salaryExpenseCoverage';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { computeAllNetWorthChartBucketsSAR } from '../services/personalNetWorth';
import { useExtendedCanonicalMetrics, useCanonicalSimulatedPrices, useCanonicalSpotFx, pickInvestmentsTotalSar, presentHeadlineInvestmentGrowth } from '../hooks/useCanonicalFinancialMetrics';
import { ExtendedMetricGate } from '../components/shared/ExtendedMetricGate';
import { usePageDeferredData } from '../context/PageDeferredDataContext';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import { detectBudgetDrift } from '../services/budgetDrift';
import SpendingCommandCenter from '../components/spending/SpendingCommandCenter';
import AnalyticsPeriodScopeBar from '../components/analytics/AnalyticsPeriodScopeBar';
import AnalyticsInsightRail from '../components/analytics/AnalyticsInsightRail';
import { useMetricPassport } from '../context/MetricPassportContext';
import { buildMetricPassportModel } from '../services/metricPassportModel';
import WealthPulseRing from '../components/analytics/WealthPulseRing';
import AnalyticsVisitDeltaChips from '../components/analytics/AnalyticsVisitDeltaChips';
import AnalysisStudioTabs from '../components/analysis/AnalysisStudioTabs';
import AnalysisExplorerTabs from '../components/analysis/AnalysisExplorerTabs';
import AnalysisExplorerContent from '../components/analysis/AnalysisExplorerContent';
import { downloadSpendingBriefCsv, downloadSpendingBriefPdf } from '../services/spendingReportExport';
import { useSpendingCommandCenterModel } from '../hooks/useSpendingCommandCenterModel';
import { useAnalyticsWorkspace } from '../context/AnalyticsWorkspaceContext';
import { DeferredMount } from '../components/dashboard/DeferredMount';
import { SectionLoadingPlaceholder } from '../components/shared/SectionLoadingPlaceholder';
import SalaryInvestmentSummaryCard from '../components/SalaryInvestmentSummaryCard';
import {
    buildVisitSnapshotFromModel,
    computeVisitDelta,
    loadAnalyticsVisitSnapshot,
    saveAnalyticsVisitSnapshot,
} from '../services/analyticsVisitSnapshot';
import {
    financialMonthKeysEndingAt,
    financialMonthIsoKey,
    financialMonthColumnHeaderLabel,
    financialMonthRangeFromKey,
    resolveMonthStartDayFromData,
    dateInRange,
    financialMonthKeyFromTransactionDate,
} from '../utils/financialMonth';

const LazyExpenseBudgetAnalysisPanel = lazy(() => import('../components/analysis/ExpenseBudgetAnalysisPanel'));

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

function buildTrendDataSar(
    transactions: Transaction[],
    accounts: Account[],
    sarPerUsd: number,
    monthStartDay: number,
    months = 6,
) {
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const now = new Date();
    const finKeys = financialMonthKeysEndingAt(now, months, monthStartDay);
    const monthMap = new Map<string, { income: number; expenses: number }>();
    finKeys.forEach((k) => monthMap.set(financialMonthIsoKey(k), { income: 0, expenses: 0 }));

    const earliest = financialMonthRangeFromKey(finKeys[0], monthStartDay).start;
    transactions.forEach((t) => {
        if (!dateInRange(t.date, earliest, now)) return;
        const key = financialMonthIsoKey(financialMonthKeyFromTransactionDate(t.date, monthStartDay));
        if (!monthMap.has(key)) return;
        const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
        const amtSar = toSAR(Math.abs(Number(t.amount) ?? 0), cur, sarPerUsd);
        const current = monthMap.get(key)!;
        if (countsAsIncomeForCashflowKpi(t)) current.income += amtSar;
        if (countsAsExpenseForCashflowKpi(t)) current.expenses += amtSar;
        monthMap.set(key, current);
    });

    return finKeys.map((k) => {
        const key = financialMonthIsoKey(k);
        const name =
            monthStartDay === 1
                ? new Date(key + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                : financialMonthColumnHeaderLabel(k.year, k.month, monthStartDay);
        return { monthKey: key, name, ...(monthMap.get(key) || { income: 0, expenses: 0 }) };
    });
}

const AssetLiabilityChart: React.FC = () => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const simulatedPrices = useCanonicalSimulatedPrices();
    const { formatCurrencyString } = useFormatCurrency();
    const toFiniteMoney = (value: unknown): number => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    const sarPerUsd = useCanonicalSpotFx();
    const chartData = useMemo(() => {
        const buckets = computeAllNetWorthChartBucketsSAR(data, sarPerUsd, { getAvailableCashForAccount, simulatedPrices });

        return [
            { name: 'Investments (platforms + commodities + Sukuk)', value: toFiniteMoney(buckets.investments) },
            { name: 'Cash', value: toFiniteMoney(buckets.cash) },
            { name: 'Physical assets', value: toFiniteMoney(buckets.physicalAndCommodities) },
            { name: 'Receivables', value: toFiniteMoney(buckets.receivables) },
            { name: 'Debt', value: toFiniteMoney(Math.abs(buckets.liabilities)) },
        ];
    }, [data, sarPerUsd, getAvailableCashForAccount, simulatedPrices]);

    const hasSignal = chartData.some((x) => Number.isFinite(x.value) && x.value > 0);
    const isEmpty = !hasSignal;
    const getBarColor = (name: string) => (name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary);

    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-600 max-w-prose">
                Uses your <strong>full</strong> account list (household-inclusive). <strong>Investments</strong> uses the same bucket taxonomy as Dashboard (platforms, commodities, Sukuk); commodities are not double-counted under Physical.
            </p>
            <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="Add accounts, holdings, or assets to see your position.">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} tickLine={false} interval={0} angle={-12} textAnchor="end" height={56} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="value" name="Value (SAR)" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry) => (
                                <Cell key={`cell-${entry.name}`} fill={getBarColor(entry.name)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartContainer>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {chartData.map((row) => (
                    <div key={`summary-${row.name}`} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 shadow-sm">
                        <span className="text-slate-600">{row.name}</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(row.value, { digits: 0 })}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const Analysis: React.FC<{ setActivePage?: (page: Page) => void; triggerPageAction?: (page: Page, action: string) => void }> = ({
    setActivePage,
    triggerPageAction,
}) => {
    const { aiHealthChecked, isAiAvailable } = useAI();
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { computeData } = usePageDeferredData();
    const engineData = computeData ?? data;
    const { currency: displayCurrency } = useCurrency();
    const simulatedPrices = useCanonicalSimulatedPrices();
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();
    const metrics = useExtendedCanonicalMetrics();
    const {
        sarPerUsd: headlineFx,
        netWorth: personalNetWorth,
        buckets: personalBuckets,
        kpiSnapshot,
        extendedReady,
        salaryInvestment,
    } = metrics;
    const presentedRoi = presentHeadlineInvestmentGrowth(kpiSnapshot?.headlineInvestmentExposure);
    useHydrateSarPerUsdDailySeries(engineData, headlineFx);
    const investmentsTotalSar = pickInvestmentsTotalSar(metrics, extendedReady);
    const { scope, periodPreset, analysisStudioTab, setAnalysisStudioTab } = useAnalyticsWorkspace();
    const { openPassport } = useMetricPassport();
    const { model: expenseBudgetAnalysis, ready: expenseBudgetReady } = useSpendingCommandCenterModel(
        engineData,
        headlineFx,
        scope,
        analysisStudioTab === 'explore' || analysisStudioTab === 'command',
        periodPreset,
    );

    const pageDescription =
        scope === 'household'
            ? 'Patterns from your full transaction ledger and all linked accounts (household view). The expense & budget cockpit uses every tag you enter on transactions. Amounts are converted to SAR so USD and SAR accounts can be compared fairly.'
            : 'Patterns from your personal transaction ledger and linked personal accounts. The expense & budget cockpit uses every tag you enter on transactions. Amounts are converted to SAR so USD and SAR accounts can be compared fairly.';

    const contextData = useMemo(() => {
        const transactions = engineData?.transactions ?? [];
        const accounts = engineData?.accounts ?? [];

        const spendingData = expenseTotalsByBudgetCategorySar(transactions as Transaction[], accounts, headlineFx, { data: engineData });

        const monthStartDay = resolveMonthStartDayFromData(engineData);
        const trendData = buildTrendDataSar(transactions as Transaction[], accounts, headlineFx, monthStartDay, 6);

        const nwBuckets = computeAllNetWorthChartBucketsSAR(engineData, headlineFx, { getAvailableCashForAccount, simulatedPrices });
        const compositionData = [
            { name: 'Investments (platforms + commodities + Sukuk)', value: nwBuckets.investments },
            { name: 'Cash', value: nwBuckets.cash },
            { name: 'Physical assets', value: nwBuckets.physicalAndCommodities },
            { name: 'Receivables', value: nwBuckets.receivables },
            { name: 'Debt', value: Math.abs(nwBuckets.liabilities) },
        ];

        const merchants = spendByMerchantSar(transactions as Transaction[], accounts, headlineFx, { months: 6, data: engineData });
        const salary = detectSalaryIncomeSar(transactions as Transaction[], accounts, headlineFx, 6, engineData);
        const subs = subscriptionSpendMonthlySar(transactions as Transaction[], accounts, headlineFx, 3, engineData);
        const bnpl = detectBnplMentionsSar(transactions as Transaction[], accounts, headlineFx);
        const refundPairs = findRefundPairsSar(transactions as Transaction[], accounts, headlineFx, 14);
        const salaryCoverage = salaryToExpenseCoverageSar(transactions as Transaction[], accounts, headlineFx, 6, engineData);

        return {
            spendingData,
            trendData,
            compositionData,
            merchants,
            salary,
            subs,
            bnpl,
            refundPairs,
            salaryCoverage,
            sarPerUsd: headlineFx,
            expenseBudgetAnalysis: expenseBudgetReady ? expenseBudgetAnalysis : null,
        };
    }, [engineData, getAvailableCashForAccount, headlineFx, simulatedPrices, expenseBudgetAnalysis, expenseBudgetReady]);

    const analysisValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const fx = headlineFx;
        const monthlyKpis = kpiSnapshot
            ? {
                budgetVariance: kpiSnapshot.budgetVariance,
                roi: kpiSnapshot.roi,
            }
            : { budgetVariance: Number.NaN, roi: Number.NaN };
        if (!Number.isFinite(fx) || fx <= 0) warnings.push('Exchange rate is invalid — USD transactions may not convert correctly.');
        if (!Number.isFinite(monthlyKpis.budgetVariance)) warnings.push('Budget variance could not be computed.');
        if (!Number.isFinite(monthlyKpis.roi)) warnings.push('Investment ROI could not be computed.');
        const ratio = contextData.salaryCoverage.ratio;
        if (ratio != null && !Number.isFinite(ratio)) warnings.push('Salary coverage ratio is invalid.');
        const rows = contextData.compositionData ?? [];
        const debtRow = rows.find((x) => x.name === 'Debt');
        const debtMag = Number(debtRow?.value) || 0;
        const assetsSum = rows.filter((x) => x.name !== 'Debt').reduce((s, x) => s + (Number(x.value) || 0), 0);
        const reconstructedNw = assetsSum - debtMag;
        const nwFromBuckets = computeAllNetWorthChartBucketsSAR(data, headlineFx, { getAvailableCashForAccount, simulatedPrices }).netWorth;
        if (Math.abs(reconstructedNw - nwFromBuckets) > 2) {
            warnings.push('Position bars do not reconcile to net worth — check accounts, liabilities, and FX (System & APIs Health → Data reconciliation).');
        }
        if ((contextData.trendData ?? []).every((x) => (x.income ?? 0) === 0 && (x.expenses ?? 0) === 0)) {
            warnings.push('No income/expense signal in the last 6 months (after SAR conversion).');
        }
        if ((contextData.spendingData ?? []).length === 0) {
            warnings.push('No categorized spending found — add expense categories to see the pie chart.');
        }
        const hasUsd = (data?.accounts ?? []).some((a) => a.currency === 'USD');
        if (hasUsd && (!Number.isFinite(fx) || fx <= 0)) warnings.push('USD accounts exist — set a valid SAR-per-USD rate in the header or Wealth Ultra.');
        if (Math.abs(personalNetWorth - personalBuckets.netWorth) > 2) {
            warnings.push('Personal headline net worth does not match chart buckets — open System & APIs Health.');
        }
        if (extendedReady && Math.abs(investmentsTotalSar - personalBuckets.investments) > 2) {
            warnings.push('Personal investment total does not match net worth investments band.');
        }
        return warnings;
    }, [data, getAvailableCashForAccount, simulatedPrices, contextData, headlineFx, kpiSnapshot, personalNetWorth, personalBuckets, investmentsTotalSar, extendedReady]);

    const budgetDriftRows = useMemo(() => detectBudgetDrift(engineData ?? null, headlineFx), [engineData, headlineFx]);
    const visitDelta = React.useMemo(() => {
        const current = buildVisitSnapshotFromModel(personalNetWorth, expenseBudgetReady ? expenseBudgetAnalysis : null);
        const prior = loadAnalyticsVisitSnapshot();
        return computeVisitDelta(prior, current);
    }, [personalNetWorth, expenseBudgetAnalysis, expenseBudgetReady]);

    React.useEffect(() => {
        if (!expenseBudgetReady) return;
        const snap = buildVisitSnapshotFromModel(personalNetWorth, expenseBudgetAnalysis);
        const onLeave = () => saveAnalyticsVisitSnapshot(snap);
        window.addEventListener('visibilitychange', onLeave);
        return () => window.removeEventListener('visibilitychange', onLeave);
    }, [personalNetWorth, expenseBudgetAnalysis, expenseBudgetReady]);

    return (
        <PageLayout
            title="Financial Analysis"
            description={pageDescription}
            action={
                setActivePage ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {expenseBudgetReady && expenseBudgetAnalysis && (
                            <>
                            <button
                                type="button"
                                className="btn-secondary text-sm"
                                onClick={() => downloadSpendingBriefCsv(expenseBudgetAnalysis)}
                            >
                                Export CSV
                            </button>
                            <button
                                type="button"
                                className="btn-secondary text-sm"
                                onClick={() => downloadSpendingBriefPdf(expenseBudgetAnalysis)}
                            >
                                Print PDF brief
                            </button>
                            </>
                        )}
                        <PageActionsDropdown
                        ariaLabel="Analysis quick links"
                        actions={[
                            { value: 'tx', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                            { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                            { value: 'accounts', label: 'Accounts', onClick: () => setActivePage('Accounts') },
                            { value: 'summary', label: 'Financial Summary', onClick: () => setActivePage('Summary') },
                            { value: 'assets', label: 'Physical assets', onClick: () => setActivePage('Assets') },
                            { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
                        ]}
                    />
                    </div>
                ) : undefined
            }
        >
            <div className="mb-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 to-white px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-700 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-900">SAR-first analysis</span>
                    <span>
                        Charts and rankings use <strong>one yardstick (SAR)</strong> so mixed-currency accounts stay comparable.
                        {displayCurrency === 'USD' && (
                            <span className="text-slate-600"> Display is USD — underlying math stays SAR, then converts for display.</span>
                        )}
                    </span>
                </div>
                <div className="text-xs sm:text-sm tabular-nums text-slate-600 text-right">
                    <span className="font-semibold text-slate-800">1 USD = {contextData.sarPerUsd.toFixed(2)} SAR</span>
                    {displayCurrency === 'USD' && (
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                            Example: SAR 10,000 ≈ {formatSecondaryEquivalent(10000)}
                        </span>
                    )}
                </div>
            </div>

            <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-violet-900 mb-2">Personal headline (Dashboard / Summary / Investments)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                        <p className="text-slate-600">Net worth</p>
                        <p className="font-bold text-slate-900 tabular-nums">{formatCurrencyString(personalNetWorth, { digits: 0 })}</p>
                        <button
                            type="button"
                            className="text-[10px] font-semibold text-primary hover:underline mt-0.5"
                            onClick={() => {
                                const m = buildMetricPassportModel(null, 'netWorth', {
                                    valueDisplay: formatCurrencyString(personalNetWorth, { digits: 0 }),
                                    statusLabel: 'Headline',
                                    sarPerUsd: headlineFx,
                                });
                                if (m) openPassport(m);
                            }}
                        >
                            Explain
                        </button>
                    </div>
                    <div>
                        <p className="text-slate-600">Investments</p>
                        <ExtendedMetricGate ready={extendedReady} compact>
                            <p className="font-bold text-slate-900 tabular-nums">{formatCurrencyString(investmentsTotalSar, { digits: 0 })}</p>
                        </ExtendedMetricGate>
                    </div>
                    <div>
                        <p className="text-slate-600">Cash</p>
                        <p className="font-bold text-slate-900 tabular-nums">{formatCurrencyString(personalBuckets.cash, { digits: 0 })}</p>
                    </div>
                    <div>
                        <p className="text-slate-600">Investment ROI (headline)</p>
                        <ExtendedMetricGate ready={extendedReady} compact>
                            <p className="font-bold text-slate-900 tabular-nums">{presentedRoi?.valueDisplay ?? (kpiSnapshot ? `${(kpiSnapshot.roi * 100).toFixed(1)}%` : '—')}</p>
                            {kpiSnapshot ? (
                                <button
                                    type="button"
                                    className="text-[10px] font-semibold text-primary hover:underline mt-0.5"
                                    onClick={() => {
                                        const m = buildMetricPassportModel(null, 'investmentRoi', {
                                            valueDisplay: presentedRoi?.valueDisplay ?? `${(kpiSnapshot.roi * 100).toFixed(1)}%`,
                                            statusLabel: presentedRoi?.statusLabel ?? (kpiSnapshot.roi >= 0 ? 'Gain' : 'Loss'),
                                            sarPerUsd: headlineFx,
                                        });
                                        if (m) openPassport(m);
                                    }}
                                >
                                    Explain
                                </button>
                            ) : null}
                        </ExtendedMetricGate>
                    </div>
                </div>
            </div>

            <div className="mb-4">
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
                    onOpenInvestments={
                      setActivePage
                        ? () => (triggerPageAction ? triggerPageAction('Investments', 'focus-salary-invest') : setActivePage('Investments'))
                        : undefined
                    }
                    onOpenTransactions={setActivePage ? () => setActivePage('Transactions') : undefined}
                />
            </div>

            <AnalyticsPeriodScopeBar className="mb-4" />

            {visitDelta && (
                <AnalyticsVisitDeltaChips
                    delta={visitDelta}
                    formatCurrencyString={formatCurrencyString}
                    setActivePage={setActivePage}
                    onReviewNetWorth={() => setActivePage?.('Wealth Analytics')}
                    onReviewSpending={() => setAnalysisStudioTab('command')}
                    className="mb-4"
                />
            )}

            <AnalysisStudioTabs className="mb-4" />

            {analysisStudioTab === 'explore' && (
                <>
                    <AnalysisExplorerTabs className="mb-4" />
                    <div className="mb-4">
                        <AnalysisExplorerContent
                            data={engineData}
                            model={expenseBudgetReady ? expenseBudgetAnalysis : null}
                            setActivePage={setActivePage}
                            triggerPageAction={triggerPageAction}
                        />
                    </div>
                    {aiHealthChecked && !isAiAvailable && (
                        <AiProxyUnavailableHint className="mb-4 mt-4" variant="banner" title="Spend insights coach needs the AI proxy" />
                    )}
                    <AIAdvisor
                        pageContext="analysis"
                        contextData={{
                            ...contextData,
                            expenseBudgetAnalysis: expenseBudgetReady ? expenseBudgetAnalysis : null,
                            periodPreset,
                            scope,
                        }}
                    />
                    {analysisValidationWarnings.length > 0 && (
                        <div className="mb-4 rounded-2xl border-l-4 border-l-amber-500 bg-amber-50/90 border border-amber-100 px-4 py-3 shadow-sm mt-4" role="status">
                            <p className="text-sm font-semibold text-amber-950">Data checks</p>
                            <p className="text-xs text-amber-900/90 mt-1 mb-2">Fix these for the most reliable analysis.</p>
                            <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4">
                                {analysisValidationWarnings.slice(0, 10).map((w, i) => (
                                    <li key={`av-${i}`}>{w}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}

            {analysisStudioTab === 'command' && (
                <div className="space-y-4 mb-4">
                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 items-start">
                        <div className="min-w-0 space-y-4">
                    <SpendingCommandCenter
                        model={expenseBudgetAnalysis}
                        ready={expenseBudgetReady}
                        hideDetailPanel
                        setActivePage={setActivePage}
                        triggerPageAction={triggerPageAction}
                    />
                    <DeferredMount minHeight="12rem" staggerIndex={0}>
                        <Suspense fallback={<SectionLoadingPlaceholder labelKey="sectionLoading" minHeight="12rem" />}>
                            <LazyExpenseBudgetAnalysisPanel
                                model={expenseBudgetAnalysis}
                                ready={expenseBudgetReady}
                                setActivePage={setActivePage}
                                triggerPageAction={triggerPageAction}
                            />
                        </Suspense>
                    </DeferredMount>
                        </div>
                        {expenseBudgetReady && (
                            <AnalyticsInsightRail
                                model={expenseBudgetAnalysis}
                                driftRows={budgetDriftRows}
                                visitDelta={visitDelta}
                                setActivePage={setActivePage}
                                triggerPageAction={triggerPageAction}
                                className="xl:sticky xl:top-4"
                            />
                        )}
                    </div>
                </div>
            )}

            {analysisStudioTab === 'position' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-4 min-h-[380px] flex flex-col border-t-4 border-t-primary/30 space-y-4">
                    <div>
                        <h3 className="text-base font-semibold text-slate-900 mb-1">Current financial position</h3>
                        <p className="text-xs text-slate-500">Major buckets that build your net worth (same SAR math as Investments &amp; Assets).</p>
                    </div>
                    <ExtendedMetricGate ready={extendedReady} className="flex flex-col sm:flex-row items-center gap-6">
                        <WealthPulseRing
                            netWorthSar={personalNetWorth ?? 0}
                            segments={[
                                { id: 'cash', label: 'Cash', valueSar: personalBuckets.cash, color: '#10b981', onClick: () => setActivePage?.('Accounts') },
                                { id: 'inv', label: 'Invest', valueSar: personalBuckets.investments, color: '#8b5cf6', onClick: () => setActivePage?.('Investments') },
                                { id: 'phys', label: 'Physical', valueSar: personalBuckets.physicalAndCommodities, color: '#f59e0b', onClick: () => setActivePage?.('Assets') },
                                { id: 'debt', label: 'Debt', valueSar: Math.abs(personalBuckets.liabilities), color: '#f43f5e', onClick: () => setActivePage?.('Liabilities') },
                            ]}
                            formatCurrency={(n) => formatCurrencyString(n, { digits: 0 })}
                        />
                        <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden w-full">
                            <AssetLiabilityChart />
                        </div>
                    </ExtendedMetricGate>
                </div>
            )}
        </PageLayout>
    );
};

export default Analysis;
