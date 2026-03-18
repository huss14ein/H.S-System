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
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

const normalizeTxType = (type?: string) => String(type ?? '').toLowerCase();
const isExpenseTx = (t: Transaction) => normalizeTxType(t.type) === 'expense';
const isIncomeTx = (t: Transaction) => normalizeTxType(t.type) === 'income';
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
        if (isIncomeTx(t)) current.income += Math.abs(Number(t.amount) ?? 0);
        if (isExpenseTx(t)) current.expenses += Math.abs(Number(t.amount) ?? 0);
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
        const txs = (data as any)?.personalTransactions ?? data?.transactions ?? [];
        txs.filter(isExpenseTx)
            .forEach((t: { budgetCategory?: string; category?: string; amount?: number }) => {
                const rawCategory = (t.budgetCategory || t.category || 'Uncategorized').trim();
                const category = rawCategory.length > 0 ? rawCategory : 'Uncategorized';
                spending.set(category, (spending.get(category) || 0) + Math.abs(Number(t.amount) ?? 0));
            });
        return Array.from(spending, ([name, value]) => ({ name, value }))
            .filter((x) => Number.isFinite(x.value) && x.value > 0)
            .sort((a, b) => b.value - a.value);
    }, [data?.transactions, (data as any)?.personalTransactions]);
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
    const chartData = useMemo(() => buildTrendData((data as any)?.personalTransactions ?? data?.transactions ?? [], 6), [data?.transactions, (data as any)?.personalTransactions]);
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
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const d = data as any;
        const inv = d?.personalInvestments ?? data?.investments ?? [];
        const acc = d?.personalAccounts ?? data?.accounts ?? [];
        const ast = d?.personalAssets ?? data?.assets ?? [];
        const liab = d?.personalLiabilities ?? data?.liabilities ?? [];

        const totalInvestments = getAllInvestmentsValueInSAR(inv, exchangeRate);
        const totalCash = acc.filter((a: { type?: string; balance?: number }) => a.type !== 'Credit').reduce((sum: number, a: { balance?: number }) => sum + Math.max(0, a.balance ?? 0), 0);
        const totalPhysicalAssets = ast.reduce((sum: number, asset: { value?: number }) => sum + Math.max(0, asset.value || 0), 0);
        const totalDebt = liab.filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((sum: number, l: { amount?: number }) => sum + Math.abs(l.amount ?? 0), 0)
            + acc.filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum: number, a: { balance?: number }) => sum + Math.abs(a.balance ?? 0), 0);
        const totalReceivable = liab.filter((l: { amount?: number; type?: string }) => (l.amount ?? 0) > 0 || l.type === 'Receivable').reduce((sum: number, l: { amount?: number }) => sum + Math.max(0, l.amount ?? 0), 0);

        return [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Receivables', value: totalReceivable },
            { name: 'Debt', value: totalDebt },
        ];
    }, [data, exchangeRate]);

    const hasSignal = chartData.some((x) => x.value > 0);
    const isEmpty = !hasSignal;
    const getBarColor = (name: string) => name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary;

    return (
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
    );
};

const Analysis: React.FC<{ setActivePage?: (page: Page) => void }> = () => {
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();

    const contextData = useMemo(() => {
        const d = data as any;
        const transactions = d?.personalTransactions ?? data?.transactions ?? [];
        const investments = d?.personalInvestments ?? data?.investments ?? [];
        const accounts = d?.personalAccounts ?? data?.accounts ?? [];
        const assets = d?.personalAssets ?? data?.assets ?? [];
        const liabilities = d?.personalLiabilities ?? data?.liabilities ?? [];

        const spendingMap = new Map<string, number>();
        transactions.filter(isExpenseTx).forEach((t: { budgetCategory?: string; category?: string; amount?: number }) => {
            const category = (t.budgetCategory || t.category || 'Uncategorized').trim() || 'Uncategorized';
            spendingMap.set(category, (spendingMap.get(category) || 0) + Math.abs(Number(t.amount) ?? 0));
        });
        const spendingData = Array.from(spendingMap, ([name, value]: [string, number]) => ({ name, value }))
            .filter((x) => x.value > 0)
            .sort((a, b) => b.value - a.value);

        const trendData = buildTrendData(transactions, 6);

        const totalInvestments = getAllInvestmentsValueInSAR(investments, exchangeRate);
        const totalCash = accounts.filter((a: { type?: string; balance?: number }) => a.type !== 'Credit').reduce((sum: number, acc: { balance?: number }) => sum + Math.max(0, acc.balance ?? 0), 0);
        const totalPhysicalAssets = assets.reduce((sum: number, asset: { value?: number }) => sum + Math.max(0, asset.value || 0), 0);
        const totalDebt = liabilities.filter((l: { amount?: number }) => (l.amount ?? 0) < 0).reduce((sum: number, liab: { amount?: number }) => sum + Math.abs(liab.amount ?? 0), 0)
            + accounts.filter((a: { type?: string; balance?: number }) => a.type === 'Credit' && (a.balance ?? 0) < 0).reduce((sum: number, acc: { balance?: number }) => sum + Math.abs(acc.balance ?? 0), 0);
        const totalReceivable = liabilities.filter((l: { amount?: number; type?: string }) => (l.amount ?? 0) > 0 || l.type === 'Receivable').reduce((sum: number, liab: { amount?: number }) => sum + Math.max(0, liab.amount ?? 0), 0);
        const compositionData = [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Receivables', value: totalReceivable },
            { name: 'Debt', value: totalDebt },
        ];

        return { spendingData, trendData, compositionData };
    }, [data, exchangeRate]);

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
        >
            <AIAdvisor pageContext="analysis" contextData={contextData} />

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2 mt-6">
                <SectionCard title="Spending by Budget Category" className="min-h-[380px] flex flex-col">
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <SpendingByCategoryChart />
                    </div>
                </SectionCard>
                <SectionCard title="Monthly Income vs. Expense" className="min-h-[380px] flex flex-col">
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <IncomeExpenseTrendChart />
                    </div>
                </SectionCard>
                <SectionCard title="Current Financial Position" className="lg:col-span-2 min-h-[380px] flex flex-col">
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <AssetLiabilityChart />
                    </div>
                </SectionCard>
            </div>
        </PageLayout>
    );
};

export default Analysis;
