
import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { CHART_COLORS, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber } from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';

const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' };

// Spending by Category Chart
const SpendingByCategoryChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const spending = new Map<string, number>();
        (data?.transactions ?? [])
            .filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        return Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
    }, [data?.transactions]);
    const isEmpty = !chartData?.length;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No spending by category for this period.">
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

// Income vs Expense Trend
const IncomeExpenseTrendChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const trends = new Map<string, { income: number, expenses: number }>();
        (data?.transactions ?? []).forEach(t => {
            const month = new Date(t.date).toLocaleString('default', { month: 'short', year: '2-digit' });
            const current = trends.get(month) || { income: 0, expenses: 0 };
            if (t.type === 'income') {
                current.income += t.amount;
            } else {
                current.expenses += Math.abs(t.amount);
            }
            trends.set(month, current);
        });
        return Array.from(trends, ([name, value]) => ({ name, date: new Date(name), ...value }))
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [data?.transactions]);
    const isEmpty = !chartData?.length;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No income vs expense trend data.">
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
}

// Asset vs Liability Composition
const AssetLiabilityChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const inv = data?.investments ?? [];
        const acc = data?.accounts ?? [];
        const ast = data?.assets ?? [];
        const liab = data?.liabilities ?? [];
        const totalInvestments = inv.reduce((sum, p) => sum + (p.holdings ?? []).reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        const totalCash = acc.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, a) => sum + Math.max(0, a.balance), 0);
        const totalPhysicalAssets = ast.reduce((sum, asset) => sum + asset.value, 0);
        const totalDebt = liab.filter((l: { amount: number }) => l.amount < 0).reduce((sum: number, l: { amount: number }) => sum + Math.abs(l.amount), 0) + acc.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, a) => sum + Math.abs(a.balance), 0);
        const totalReceivable = liab.filter((l: { amount: number }) => l.amount > 0).reduce((sum: number, l: { amount: number }) => sum + l.amount, 0);
        return [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Receivables', value: totalReceivable },
            { name: 'Debt', value: totalDebt },
        ];
    }, [data]);
    const isEmpty = !chartData?.length;
    const getBarColor = (name: string) => name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary;

    return (
        <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No asset/liability data.">
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
}


const Analysis: React.FC = () => {
    const { data, loading } = useContext(DataContext)!;

    const contextData = useMemo(() => {
        const transactions = data?.transactions ?? [];
        const investments = data?.investments ?? [];
        const accounts = data?.accounts ?? [];
        const assets = data?.assets ?? [];
        const liabilities = data?.liabilities ?? [];

        // Spending Data
        const spending = new Map<string, number>();
        transactions.filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        const spendingData = Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

        // Trend Data
        const trends = new Map<string, { income: number, expenses: number }>();
        transactions.forEach(t => {
            const month = new Date(t.date).toLocaleString('default', { month: 'short', year: '2-digit' });
            const current = trends.get(month) || { income: 0, expenses: 0 };
            if (t.type === 'income') current.income += t.amount;
            else current.expenses += Math.abs(t.amount);
            trends.set(month, current);
        });
        const trendData = Array.from(trends, ([name, value]) => ({ name, date: new Date(name), ...value }))
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .slice(-6); // Last 6 months

        // Composition Data
        const totalInvestments = investments.reduce((sum, p) => sum + (p.holdings ?? []).reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        const totalCash = accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        const totalPhysicalAssets = assets.reduce((sum, asset) => sum + asset.value, 0);
        const totalDebt = liabilities.filter((l: { amount: number }) => l.amount < 0).reduce((sum: number, liab: { amount: number }) => sum + Math.abs(liab.amount), 0) + accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum: number, acc: { balance: number }) => sum + Math.abs(acc.balance), 0);
        const totalReceivable = liabilities.filter((l: { amount: number }) => l.amount > 0).reduce((sum: number, liab: { amount: number }) => sum + liab.amount, 0);
        const compositionData = [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Receivables', value: totalReceivable },
            { name: 'Debt', value: totalDebt },
        ];
        
        return { spendingData, trendData, compositionData };
    }, [data]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout title="Financial Analysis">
            <AIAdvisor pageContext="analysis" contextData={contextData} />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
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
