import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { CHART_COLORS, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber } from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';
import type { Transaction, Page } from '../types';
import {
  spendByMerchant,
  detectSalaryIncome,
  subscriptionSpendMonthly,
  detectBnplMentions,
  findRefundPairs,
} from '../services/transactionIntelligence';
import { salaryToExpenseCoverage } from '../services/salaryExpenseCoverage';
import { useCurrency } from '../context/CurrencyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from '../services/transactionFilters';
import { computeAllNetWorthChartBucketsSAR } from '../services/personalNetWorth';
import { computeMonthlyReportFinancialKpis } from '../services/wealthSummaryReportModel';

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

const getMonthKey = (input: string | Date) => {
    const d = new Date(input);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const buildTrendData = (transactions: Transaction[], months = 6) => {
    const monthMap = new Map<string, { income: number; expenses: number }>();
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthMap.set(getMonthKey(d), { income: 0, expenses: 0 });
    }

    transactions.forEach((t) => {
        const key = getMonthKey(t.date);
        if (!monthMap.has(key)) return;
        const current = monthMap.get(key)!;
        if (countsAsIncomeForCashflowKpi(t)) current.income += Math.abs(Number(t.amount) ?? 0);
        if (countsAsExpenseForCashflowKpi(t)) current.expenses += Math.abs(Number(t.amount) ?? 0);
        monthMap.set(key, current);
    });

    return Array.from(monthMap.entries()).map(([key, value]) => ({
        monthKey: key,
        name: monthLabel(key),
        ...value,
    }));
};

const SpendingByCategoryChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const spending = new Map<string, number>();
        /** Full user ledger — not `personalTransactions` (subset when mixed household/personal accounts). */
        const txs = data?.transactions ?? [];
        txs.filter((t: Transaction) => countsAsExpenseForCashflowKpi(t))
            .forEach((t: { budgetCategory?: string; category?: string; amount?: number }) => {
                const rawCategory = (t.budgetCategory || t.category || 'Uncategorized').trim();
                const category = rawCategory.length > 0 ? rawCategory : 'Uncategorized';
                spending.set(category, (spending.get(category) || 0) + Math.abs(Number(t.amount) ?? 0));
            });
        return Array.from(spending, ([name, value]) => ({ name, value }))
            .filter((x) => Number.isFinite(x.value) && x.value > 0)
            .sort((a, b) => b.value - a.value);
    }, [data?.transactions]);
    const isEmpty = !chartData.length;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No spending-by-category data yet. Add expense transactions with categories.">
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
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => buildTrendData(data?.transactions ?? [], 6), [data?.transactions]);
    const hasSignal = chartData.some((x) => x.income > 0 || x.expenses > 0);
    const isEmpty = !hasSignal;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No income/expense trend for the last 6 months.">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                    <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                    <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="income" stroke={CHART_COLORS.positive} strokeWidth={2} name="Income" dot={{ fill: CHART_COLORS.positive }} />
                    <Line type="monotone" dataKey="expenses" stroke={CHART_COLORS.negative} strokeWidth={2} name="Expenses" dot={{ fill: CHART_COLORS.negative }} />
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
            { name: 'Investments', value: toFiniteMoney(buckets.investments) },
            { name: 'Cash', value: toFiniteMoney(buckets.cash) },
            { name: 'Physical Assets', value: toFiniteMoney(buckets.physicalAndCommodities) },
            { name: 'Receivables', value: toFiniteMoney(buckets.receivables) },
            { name: 'Debt', value: toFiniteMoney(Math.abs(buckets.liabilities)) },
        ];
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const hasSignal = chartData.some((x) => Number.isFinite(x.value) && x.value > 0);
    const isEmpty = !hasSignal;
    const getBarColor = (name: string) => name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary;

    return (
        <div className="space-y-3">
            <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No assets/liabilities available yet.">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="value" name="Value" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry) => (
                                <Cell key={`cell-${entry.name}`} fill={getBarColor(entry.name)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartContainer>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {chartData.map((row) => (
                    <div key={`summary-${row.name}`} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5">
                        <span className="text-slate-600">{row.name}</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{formatCurrencyString(row.value, { digits: 0 })}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const Analysis: React.FC<{ setActivePage?: (page: Page) => void }> = () => {
    const { data, loading, getAvailableCashForAccount } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();

    const contextData = useMemo(() => {
        /** Analysis uses the full ledger so household-tagged accounts aren’t hidden after a partial personal match. */
        const transactions = data?.transactions ?? [];

        const spendingMap = new Map<string, number>();
        transactions.filter((t: Transaction) => countsAsExpenseForCashflowKpi(t)).forEach((t: { budgetCategory?: string; category?: string; amount?: number }) => {
            const category = (t.budgetCategory || t.category || 'Uncategorized').trim() || 'Uncategorized';
            spendingMap.set(category, (spendingMap.get(category) || 0) + Math.abs(Number(t.amount) ?? 0));
        });
        const spendingData = Array.from(spendingMap, ([name, value]: [string, number]) => ({ name, value }))
            .filter((x) => x.value > 0)
            .sort((a, b) => b.value - a.value);

        const trendData = buildTrendData(transactions, 6);

        hydrateSarPerUsdDailySeries(data, exchangeRate);
        const fx = resolveSarPerUsd(data, exchangeRate);
        const nwBuckets = computeAllNetWorthChartBucketsSAR(data, fx, { getAvailableCashForAccount });
        const compositionData = [
            { name: 'Investments', value: nwBuckets.investments },
            { name: 'Cash', value: nwBuckets.cash },
            { name: 'Physical Assets', value: nwBuckets.physicalAndCommodities },
            { name: 'Receivables', value: nwBuckets.receivables },
            { name: 'Debt', value: Math.abs(nwBuckets.liabilities) },
        ];

        const merchants = spendByMerchant(transactions as Transaction[], { months: 6 });
        const salary = detectSalaryIncome(transactions as Transaction[], 6);
        const subs = subscriptionSpendMonthly(transactions as Transaction[], 3);
        const bnpl = detectBnplMentions(transactions as Transaction[]);
        const refundPairs = findRefundPairs(transactions as Transaction[], 14);
        const salaryCoverage = salaryToExpenseCoverage(transactions as Transaction[], 6);

        return { spendingData, trendData, compositionData, merchants, salary, subs, bnpl, refundPairs, salaryCoverage };
    }, [data, exchangeRate, getAvailableCashForAccount]);

    const analysisValidationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const fx = resolveSarPerUsd(data, exchangeRate);
        const monthlyKpis = computeMonthlyReportFinancialKpis(data, fx, getAvailableCashForAccount);
        if (!Number.isFinite(monthlyKpis.budgetVariance)) warnings.push('Budget variance could not be computed.');
        if (!Number.isFinite(monthlyKpis.roi)) warnings.push('Investment ROI could not be computed.');
        if (!Number.isFinite((contextData as any).salaryCoverage?.ratio ?? 1)) warnings.push('Salary coverage ratio is invalid.');
        if (((contextData as any).trendData ?? []).every((x: { income: number; expenses: number }) => (x.income ?? 0) === 0 && (x.expenses ?? 0) === 0)) {
            warnings.push('No income/expense signal in the last 6 months.');
        }
        if (((contextData as any).spendingData ?? []).length === 0) warnings.push('No categorized spending data found.');
        return warnings;
    }, [data, exchangeRate, getAvailableCashForAccount, contextData]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center h-96" aria-busy="true">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" aria-label="Loading analysis" />
            </div>
        );
    }

    return (
        <PageLayout
            title="Financial Analysis"
            description="Spend trends, merchants, and balances use your full ledger and all accounts (household-inclusive). Dashboard and Summary still use personal-wealth scope for headline net worth."
        >
            <AIAdvisor pageContext="analysis" contextData={contextData} />

            {analysisValidationWarnings.length > 0 && (
                <SectionCard title="Analysis validation checks" collapsible collapsibleSummary="Data quality and wiring checks" defaultExpanded>
                    <ul className="space-y-1 text-sm text-amber-800">
                        {analysisValidationWarnings.slice(0, 6).map((w, i) => (
                            <li key={`av-${i}`}>- {w}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}

            <SectionCard title="Salary vs expense coverage" collapsible collapsibleSummary="Coverage ratio" defaultExpanded
            >
                <p className="text-sm text-slate-700 mb-2">
                    {(contextData as any).salaryCoverage?.ratio != null ? (
                        <>
                            <strong className="text-lg tabular-nums">{(contextData as any).salaryCoverage.ratio.toFixed(2)}×</strong>
                            <span className="text-slate-600 ml-2">{(contextData as any).salaryCoverage.label}</span>
                            {(contextData as any).salaryCoverage.healthy === false && (
                                <span className="block mt-2 text-amber-800 text-sm font-medium">
                                    Salary signal does not fully cover average spend—review discretionary expenses or income sources.
                                </span>
                            )}
                            {(contextData as any).salaryCoverage.healthy === true && (
                                <span className="block mt-2 text-emerald-700 text-sm">Estimated salary covers typical monthly expenses.</span>
                            )}
                        </>
                    ) : (
                        <span className="text-slate-500">{(contextData as any).salaryCoverage?.label}</span>
                    )}
                </p>
                <p className="text-xs text-slate-400">Heuristic from largest monthly credits vs 6-mo avg external expenses.</p>
            </SectionCard>

            <SectionCard title="Spend intelligence" collapsible collapsibleSummary="Subscriptions, patterns"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    <div>
                        <h4 className="font-semibold text-slate-800 mb-2">Top merchants (6 mo, excl. transfers)</h4>
                        <ul className="space-y-1 text-slate-600 max-h-40 overflow-y-auto">
                            {((contextData as any).merchants?.length ?? 0) === 0 ? (
                                <li className="text-slate-500">No expense data in range.</li>
                            ) : (
                                (contextData as any).merchants.slice(0, 8).map((m: { merchant: string; total: number }) => (
                                    <li key={m.merchant} className="flex justify-between gap-2">
                                        <span className="truncate">{m.merchant}</span>
                                        <span className="font-medium shrink-0">{formatCurrencyString(m.total, { digits: 0 })}</span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <h4 className="font-semibold text-slate-800 mb-1">Salary signal</h4>
                            <p className="text-slate-600">
                                {(contextData as any).salary?.detected
                                  ? `${(contextData as any).salary.label} (${(contextData as any).salary.confidence} confidence)`
                                  : (contextData as any).salary?.label ?? '—'}
                            </p>
                        </div>
                        <div>
                            <h4 className="font-semibold text-slate-800 mb-1">Subscription-like spend (3 mo avg)</h4>
                            <p className="text-slate-600">
                                ~{formatCurrencyString((contextData as any).subs?.monthlyEstimate ?? 0, { digits: 0 })}/mo ·{' '}
                                {(contextData as any).subs?.count ?? 0} matching txs (heuristic)
                            </p>
                        </div>
                        {(contextData as any).bnpl?.length > 0 && (
                            <div>
                                <h4 className="font-semibold text-amber-800 mb-1">BNPL-style mentions</h4>
                                <p className="text-xs text-slate-500 mb-1">Consider tracking as liabilities if applicable.</p>
                                <ul className="text-xs text-slate-600 space-y-0.5">
                                    {(contextData as any).bnpl.slice(0, 5).map((b: { description: string; amount: number }, i: number) => (
                                        <li key={i}>{b.description?.slice(0, 48)} — {formatCurrencyString(b.amount, { digits: 0 })}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </SectionCard>

            {((contextData as any).refundPairs?.length ?? 0) > 0 && (
                <SectionCard title="Possible refund pairs" collapsible collapsibleSummary="Duplicate detection"
                >
                    <p className="text-xs text-slate-500 mb-3">
                        Expense + income with similar amounts within 14 days (heuristic). Verify in Transactions.
                    </p>
                    <ul className="text-sm space-y-2">
                        {(contextData as any).refundPairs.slice(0, 15).map((r: { expenseId: string; incomeId: string; amount: number; daysApart: number }) => {
                            const txs = data?.transactions ?? [];
                            const ex = txs.find((t: Transaction) => t.id === r.expenseId);
                            const inc = txs.find((t: Transaction) => t.id === r.incomeId);
                            return (
                                <li key={`${r.expenseId}-${r.incomeId}`} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-100 pb-2">
                                    <span className="font-medium text-slate-800">{formatCurrencyString(r.amount, { digits: 0 })}</span>
                                    <span className="text-slate-500">{r.daysApart.toFixed(1)}d apart</span>
                                    <span className="text-slate-600 truncate max-w-full">Out: {ex?.description?.slice(0, 40) ?? r.expenseId}</span>
                                    <span className="text-slate-600 truncate max-w-full">In: {inc?.description?.slice(0, 40) ?? r.incomeId}</span>
                                </li>
                            );
                        })}
                    </ul>
                </SectionCard>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                <SectionCard title="Spending by Budget Category" className="min-h-[380px] flex flex-col" collapsible collapsibleSummary="Category breakdown" defaultExpanded
                >
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <SpendingByCategoryChart />
                    </div>
                </SectionCard>
                <SectionCard title="Monthly Income vs. Expense" className="min-h-[380px] flex flex-col" collapsible collapsibleSummary="Income vs spend"
                >
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <IncomeExpenseTrendChart />
                    </div>
                </SectionCard>
                <SectionCard title="Current Financial Position" className="lg:col-span-2 min-h-[380px] flex flex-col" collapsible collapsibleSummary="Net worth composition"
                >
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <AssetLiabilityChart />
                    </div>
                </SectionCard>
            </div>
        </PageLayout>
    );
};

export default Analysis;
