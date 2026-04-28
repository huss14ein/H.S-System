import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
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
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { computeAllNetWorthChartBucketsSAR } from '../services/personalNetWorth';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';
import { useMarketData } from '../context/MarketDataContext';

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

const getMonthKey = (input: string | Date) => {
    const d = new Date(input);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

/** Income vs expense months — amounts normalized to SAR using each account's currency. */
function buildTrendDataSar(transactions: Transaction[], accounts: Account[], sarPerUsd: number, months = 6) {
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const monthMap = new Map<string, { income: number; expenses: number }>();
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthMap.set(getMonthKey(d), { income: 0, expenses: 0 });
    }

    transactions.forEach((t) => {
        const key = getMonthKey(t.date);
        if (!monthMap.has(key)) return;
        const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
        const amtSar = toSAR(Math.abs(Number(t.amount) ?? 0), cur, sarPerUsd);
        const current = monthMap.get(key)!;
        if (countsAsIncomeForCashflowKpi(t)) current.income += amtSar;
        if (countsAsExpenseForCashflowKpi(t)) current.expenses += amtSar;
        monthMap.set(key, current);
    });

    return Array.from(monthMap.entries()).map(([key, value]) => ({
        monthKey: key,
        name: monthLabel(key),
        ...value,
    }));
}

const SpendingByCategoryChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const txs = data?.transactions ?? [];
        const accounts = data?.accounts ?? [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        return expenseTotalsByBudgetCategorySar(txs as Transaction[], accounts, fx);
    }, [data?.transactions, data?.accounts, data, exchangeRate]);
    const isEmpty = !chartData.length;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No categorized spending yet. Tag expenses with a category or budget group in Transactions.">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} paddingAngle={2}>
                        {chartData.map((_entry, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS.categorical[index % CHART_COLORS.categorical.length]} stroke="white" strokeWidth={1} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
            </ResponsiveContainer>
        </ChartContainer>
    );
};

const IncomeExpenseTrendChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const fx = resolveSarPerUsd(data, exchangeRate);
        return buildTrendDataSar(data?.transactions ?? [], data?.accounts ?? [], fx, 6);
    }, [data?.transactions, data?.accounts, data, exchangeRate]);
    const hasSignal = chartData.some((x) => x.income > 0 || x.expenses > 0);
    const isEmpty = !hasSignal;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No income or expense signal in the last 6 months (SAR-normalized).">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                    <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                    <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="income" stroke={CHART_COLORS.positive} strokeWidth={2} name="Income (SAR)" dot={{ fill: CHART_COLORS.positive }} />
                    <Line type="monotone" dataKey="expenses" stroke={CHART_COLORS.negative} strokeWidth={2} name="Expenses (SAR)" dot={{ fill: CHART_COLORS.negative }} />
                </LineChart>
            </ResponsiveContainer>
        </ChartContainer>
    );
};

const AssetLiabilityChart: React.FC = () => {
    const { data, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const toFiniteMoney = (value: unknown): number => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    const chartData = useMemo(() => {
        const fx = resolveSarPerUsd(data, exchangeRate);
        const buckets = computeAllNetWorthChartBucketsSAR(data, fx, { getAvailableCashForAccount });

        return [
            { name: 'Investments (incl. Sukuk)', value: toFiniteMoney(buckets.investments) },
            { name: 'Cash', value: toFiniteMoney(buckets.cash) },
            { name: 'Physical & commodities', value: toFiniteMoney(buckets.physicalAndCommodities) },
            { name: 'Receivables', value: toFiniteMoney(buckets.receivables) },
            { name: 'Debt', value: toFiniteMoney(Math.abs(buckets.liabilities)) },
        ];
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const hasSignal = chartData.some((x) => Number.isFinite(x.value) && x.value > 0);
    const isEmpty = !hasSignal;
    const getBarColor = (name: string) => (name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary);

    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-600 max-w-prose">
                Uses your <strong>full</strong> account list (household-inclusive). <strong>Investments</strong> includes brokerage cash, portfolios, and Sukuk recorded under Assets — all converted to SAR with the same rate as the rest of the app.
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

const Analysis: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage }) => {
    const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate, currency: displayCurrency } = useCurrency();
    const { simulatedPrices } = useMarketData();
    const { formatCurrencyString, formatSecondaryEquivalent } = useFormatCurrency();

    const contextData = useMemo(() => {
        const transactions = data?.transactions ?? [];
        const accounts = data?.accounts ?? [];

        hydrateSarPerUsdDailySeries(data, exchangeRate);
        const fx = resolveSarPerUsd(data, exchangeRate);

        const spendingData = expenseTotalsByBudgetCategorySar(transactions as Transaction[], accounts, fx);

        const trendData = buildTrendDataSar(transactions as Transaction[], accounts, fx, 6);

        const nwBuckets = computeAllNetWorthChartBucketsSAR(data, fx, { getAvailableCashForAccount });
        const compositionData = [
            { name: 'Investments (incl. Sukuk)', value: nwBuckets.investments },
            { name: 'Cash', value: nwBuckets.cash },
            { name: 'Physical & commodities', value: nwBuckets.physicalAndCommodities },
            { name: 'Receivables', value: nwBuckets.receivables },
            { name: 'Debt', value: Math.abs(nwBuckets.liabilities) },
        ];

        const merchants = spendByMerchantSar(transactions as Transaction[], accounts, fx, { months: 6 });
        const salary = detectSalaryIncomeSar(transactions as Transaction[], accounts, fx, 6);
        const subs = subscriptionSpendMonthlySar(transactions as Transaction[], accounts, fx, 3);
        const bnpl = detectBnplMentionsSar(transactions as Transaction[], accounts, fx);
        const refundPairs = findRefundPairsSar(transactions as Transaction[], accounts, fx, 14);
        const salaryCoverage = salaryToExpenseCoverageSar(transactions as Transaction[], accounts, fx, 6);

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
            sarPerUsd: fx,
        };
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const analysisValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const monthlyKpis = computeMonthlyReportFinancialKpis(data, fx, getAvailableCashForAccount, simulatedPrices);
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
        const nwFromBuckets = computeAllNetWorthChartBucketsSAR(data, fx, { getAvailableCashForAccount }).netWorth;
        if (Math.abs(reconstructedNw - nwFromBuckets) > 2) {
            warnings.push('Position bars do not reconcile to net worth — check accounts, liabilities, and FX.');
        }
        if ((contextData.trendData ?? []).every((x) => (x.income ?? 0) === 0 && (x.expenses ?? 0) === 0)) {
            warnings.push('No income/expense signal in the last 6 months (after SAR conversion).');
        }
        if ((contextData.spendingData ?? []).length === 0) {
            warnings.push('No categorized spending found — add expense categories to see the pie chart.');
        }
        const hasUsd = (data?.accounts ?? []).some((a) => a.currency === 'USD');
        if (hasUsd && (!Number.isFinite(fx) || fx <= 0)) warnings.push('USD accounts exist — set a valid SAR-per-USD rate in the header or Wealth Ultra.');
        return warnings;
    }, [data, exchangeRate, getAvailableCashForAccount, simulatedPrices, contextData]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading analysis" />
            </div>
        );
    }

    const cov = contextData.salaryCoverage;
    const coverageTone =
        cov.healthy === true ? 'border-l-emerald-500 bg-emerald-50/50' : cov.healthy === false ? 'border-l-amber-500 bg-amber-50/50' : 'border-l-slate-300 bg-slate-50/80';

    return (
        <PageLayout
            title="Financial Analysis"
            description="Patterns from your full transaction ledger and all linked accounts (household view). Amounts are converted to SAR so USD and SAR accounts can be compared fairly. Dashboard & Summary headline net worth still use personal-only scope."
            action={
                setActivePage ? (
                    <PageActionsDropdown
                        ariaLabel="Analysis quick links"
                        actions={[
                            { value: 'tx', label: 'Transactions', onClick: () => setActivePage('Transactions') },
                            { value: 'budgets', label: 'Budgets', onClick: () => setActivePage('Budgets') },
                            { value: 'accounts', label: 'Accounts', onClick: () => setActivePage('Accounts') },
                            { value: 'summary', label: 'Financial Summary', onClick: () => setActivePage('Summary') },
                            { value: 'assets', label: 'Assets (Sukuk)', onClick: () => setActivePage('Assets') },
                            { value: 'investments', label: 'Investments', onClick: () => setActivePage('Investments') },
                        ]}
                    />
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

            <AIAdvisor pageContext="analysis" contextData={contextData} />

            {analysisValidationWarnings.length > 0 && (
                <div className="mb-4 rounded-2xl border-l-4 border-l-amber-500 bg-amber-50/90 border border-amber-100 px-4 py-3 shadow-sm" role="status">
                    <p className="text-sm font-semibold text-amber-950">Data checks</p>
                    <p className="text-xs text-amber-900/90 mt-1 mb-2">Fix these for the most reliable analysis.</p>
                    <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4">
                        {analysisValidationWarnings.slice(0, 10).map((w, i) => (
                            <li key={`av-${i}`}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-4 ${coverageTone} border-l-4`}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-slate-900">Salary vs typical spending</h3>
                    {cov.healthy === true && (
                        <span className="text-[11px] font-bold uppercase rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5 ring-1 ring-emerald-200">Comfortable band</span>
                    )}
                    {cov.healthy === false && (
                        <span className="text-[11px] font-bold uppercase rounded-full bg-amber-100 text-amber-950 px-2 py-0.5 ring-1 ring-amber-200">Tight</span>
                    )}
                    {cov.healthy === null && (
                        <span className="text-[11px] font-bold uppercase rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 ring-1 ring-slate-200">Needs signal</span>
                    )}
                </div>
                <p className="text-sm text-slate-700 mb-2">
                    {cov.ratio != null ? (
                        <>
                            <strong className="text-2xl tabular-nums text-slate-900">{cov.ratio.toFixed(2)}×</strong>
                            <span className="text-slate-600 ml-2">{cov.label}</span>
                            {cov.healthy === false && (
                                <span className="block mt-3 text-amber-900 text-sm rounded-lg bg-amber-50/80 px-3 py-2 border border-amber-100">
                                    Typical spend is close to or above the detected salary pattern — review subscriptions and large categories, or confirm income is categorized as salary.
                                </span>
                            )}
                            {cov.healthy === true && (
                                <span className="block mt-3 text-emerald-900 text-sm rounded-lg bg-emerald-50/80 px-3 py-2 border border-emerald-100">
                                    Detected salary signal is above average spending — room for saving or investing if that matches your reality.
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="text-slate-600">{cov.label}</span>
                    )}
                </p>
                <p className="text-xs text-slate-500">
                    Heuristic: largest monthly <strong>credits</strong> vs average <strong>external expenses</strong> (both in SAR). Not payroll-grade — use it as a directional check.
                </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm mb-4">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Spend intelligence</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                        <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />
                            Top places (6 mo, SAR)
                        </h4>
                        <ul className="space-y-1.5 text-slate-700 max-h-48 overflow-y-auto pr-1">
                            {(contextData.merchants?.length ?? 0) === 0 ? (
                                <li className="text-slate-500">No expense history in this window.</li>
                            ) : (
                                contextData.merchants.slice(0, 10).map((m, idx) => (
                                    <li key={m.merchant} className="flex justify-between gap-2">
                                        <span className="truncate text-slate-700">
                                            <span className="text-slate-400 mr-1">{idx + 1}.</span>
                                            {m.merchant}
                                        </span>
                                        <span className="font-semibold shrink-0 tabular-nums text-slate-900">{formatCurrencyString(m.total, { digits: 0 })}</span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                    <div className="space-y-4">
                        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                            <h4 className="font-semibold text-slate-800 mb-1">Salary pattern</h4>
                            <p className="text-slate-700">
                                {contextData.salary?.detected
                                    ? `${contextData.salary.label} · ${contextData.salary.confidence} confidence`
                                    : contextData.salary?.label ?? '—'}
                            </p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                            <h4 className="font-semibold text-slate-800 mb-1">Subscription-style spend (3 mo avg)</h4>
                            <p className="text-slate-700">
                                ~{formatCurrencyString(contextData.subs?.monthlyEstimate ?? 0, { digits: 0 })}/mo · {contextData.subs?.count ?? 0} matching
                                transactions <span className="text-slate-500">(keyword heuristic)</span>
                            </p>
                        </div>
                        {(contextData.bnpl?.length ?? 0) > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                                <h4 className="font-semibold text-amber-950 mb-1">Buy-now-pay-later mentions</h4>
                                <p className="text-xs text-amber-900/90 mb-2">Flagged from descriptions — consider tracking balances if you use these services.</p>
                                <ul className="text-xs text-amber-950 space-y-1">
                                    {contextData.bnpl.slice(0, 6).map((b, i) => (
                                        <li key={i} className="flex justify-between gap-2">
                                            <span className="truncate">{b.description?.slice(0, 52)}</span>
                                            <span className="font-medium shrink-0 tabular-nums">{formatCurrencyString(b.amount, { digits: 0 })}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {(contextData.refundPairs?.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-5 shadow-sm mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">Possible refunds</h3>
                    <p className="text-xs text-slate-600 mb-3">
                        Expense and income with similar <strong>SAR</strong> amounts within 14 days. Confirm in Transactions before relying on it.
                    </p>
                    <ul className="text-sm space-y-2">
                        {contextData.refundPairs.slice(0, 15).map((r) => {
                            const txs = data?.transactions ?? [];
                            const ex = txs.find((t: Transaction) => t.id === r.expenseId);
                            const inc = txs.find((t: Transaction) => t.id === r.incomeId);
                            return (
                                <li key={`${r.expenseId}-${r.incomeId}`} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-sky-100 pb-2">
                                    <span className="font-semibold text-slate-900 tabular-nums">{formatCurrencyString(r.amount, { digits: 0 })}</span>
                                    <span className="text-slate-500">{r.daysApart.toFixed(1)}d apart</span>
                                    <span className="text-slate-600 truncate max-w-full">Out: {ex?.description?.slice(0, 40) ?? r.expenseId}</span>
                                    <span className="text-slate-600 truncate max-w-full">In: {inc?.description?.slice(0, 40) ?? r.incomeId}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-h-[380px] flex flex-col">
                    <h3 className="text-base font-semibold text-slate-900 mb-1">Spending by category</h3>
                    <p className="text-xs text-slate-500 mb-3">Split of expenses by budget/category (SAR).</p>
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <SpendingByCategoryChart />
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm min-h-[380px] flex flex-col">
                    <h3 className="text-base font-semibold text-slate-900 mb-1">Monthly income vs expense</h3>
                    <p className="text-xs text-slate-500 mb-3">Last 6 calendar months, SAR-normalized.</p>
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <IncomeExpenseTrendChart />
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2 min-h-[380px] flex flex-col border-t-4 border-t-primary/30">
                    <h3 className="text-base font-semibold text-slate-900 mb-1">Current financial position</h3>
                    <p className="text-xs text-slate-500 mb-3">Major buckets that build your net worth (same SAR math as Investments &amp; Assets).</p>
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <AssetLiabilityChart />
                    </div>
                </div>
            </div>
        </PageLayout>
    );
};

export default Analysis;
