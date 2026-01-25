
import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';

// Spending by Category Chart
const SpendingByCategoryChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const spending = new Map<string, number>();
        data.transactions
            .filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        return Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
    }, [data.transactions]);

    const COLORS = ['#1e40af', '#3b82f6', '#93c5fd', '#60a5fa', '#bfdbfe'];

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} fill="#8884d8">
                    {chartData.map((_entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
};

// Income vs Expense Trend
const IncomeExpenseTrendChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const chartData = useMemo(() => {
        const trends = new Map<string, { income: number, expenses: number }>();
        data.transactions.forEach(t => {
            const month = new Date(t.date).toLocaleString('default', { month: 'short', year: '2-digit' });
            const current = trends.get(month) || { income: 0, expenses: 0 };
            if (t.type === 'income') {
                current.income += t.amount;
            } else {
                current.expenses += Math.abs(t.amount);
            }
            trends.set(month, current);
        });
        // Convert map to array and sort chronologically
        return Array.from(trends, ([name, value]) => ({ name, date: new Date(name), ...value }))
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [data.transactions]);

    return (
        <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} />
                <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} />
                <Legend />
                <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} name="Income" />
                <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} name="Expenses" />
            </LineChart>
        </ResponsiveContainer>
    );
}

// Asset vs Liability Composition
const AssetLiabilityChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
     const chartData = useMemo(() => {
        const totalInvestments = data.investments.reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        const totalCash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        const totalPhysicalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + Math.abs(liab.amount), 0) + data.accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
        
        return [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Liabilities', value: totalLiabilities },
        ];
    }, [data]);
    
    return (
        <ResponsiveContainer width="100%" height={300}>
             <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} />
                <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })}/>
                <Bar dataKey="value" name="Value">
                    {chartData.map((entry) => (
                        <Cell key={`cell-${entry.name}`} fill={entry.name === 'Liabilities' ? '#f87171' : '#3b82f6'} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}


const Analysis: React.FC = () => {
    const { data } = useContext(DataContext)!;

    const contextData = useMemo(() => {
        // Spending Data
        const spending = new Map<string, number>();
        data.transactions.filter(t => t.type === 'expense' && t.budgetCategory)
            .forEach(t => {
                const currentSpend = spending.get(t.budgetCategory!) || 0;
                spending.set(t.budgetCategory!, currentSpend + Math.abs(t.amount));
            });
        const spendingData = Array.from(spending, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);

        // Trend Data
        const trends = new Map<string, { income: number, expenses: number }>();
        data.transactions.forEach(t => {
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
        const totalInvestments = data.investments.reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
        const totalCash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        const totalPhysicalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + Math.abs(liab.amount), 0) + data.accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, acc) => sum + Math.abs(acc.balance), 0);
        const compositionData = [
            { name: 'Investments', value: totalInvestments },
            { name: 'Cash', value: totalCash },
            { name: 'Physical Assets', value: totalPhysicalAssets },
            { name: 'Liabilities', value: totalLiabilities },
        ];
        
        return { spendingData, trendData, compositionData };
    }, [data]);

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-dark">Financial Analysis</h1>
            
            <AIAdvisor pageContext="analysis" contextData={contextData} />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4">Spending by Budget Category</h3>
                    <SpendingByCategoryChart />
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4">Monthly Income vs. Expense</h3>
                    <IncomeExpenseTrendChart />
                </div>
                 <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4">Current Financial Position</h3>
                    <AssetLiabilityChart />
                </div>
            </div>
        </div>
    );
};

export default Analysis;
