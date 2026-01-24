
import React, { useMemo } from 'react';
import { mockFinancialData } from '../data/mockData';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

// Spending by Category Chart
const SpendingByCategoryChart = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const data = useMemo(() => {
        const spending = new Map<string, number>();
        mockFinancialData.transactions
            .filter(t => t.type === 'expense')
            .forEach(t => {
                const currentSpend = spending.get(t.category) || 0;
                spending.set(t.category, currentSpend + Math.abs(t.amount));
            });
        return Array.from(spending, ([name, value]) => ({ name, value }));
    }, []);

    const COLORS = ['#1e40af', '#3b82f6', '#93c5fd', '#60a5fa', '#bfdbfe'];

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} fill="#8884d8">
                    {data.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
};

// Income vs Expense Trend
const IncomeExpenseTrendChart = () => {
    const { formatCurrencyString } = useFormatCurrency();
    const data = useMemo(() => {
        const trends = new Map<string, { income: number, expenses: number }>();
        mockFinancialData.transactions.forEach(t => {
            const month = new Date(t.date).toLocaleString('default', { month: 'short', year: '2-digit' });
            const current = trends.get(month) || { income: 0, expenses: 0 };
            if (t.type === 'income') {
                current.income += t.amount;
            } else {
                current.expenses += Math.abs(t.amount);
            }
            trends.set(month, current);
        });
        return Array.from(trends, ([name, value]) => ({ name, ...value })).reverse();
    }, []);

    return (
        <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
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

// Asset vs Liability Growth
const AssetLiabilityChart = () => {
    const { formatCurrencyString } = useFormatCurrency();
     const data = [
        { name: '2022', assets: 2500000, liabilities: 1100000 },
        { name: '2023', assets: 3200000, liabilities: 980000 },
        { name: '2024', assets: 4000000, liabilities: 945000 },
    ];
    return (
        <ResponsiveContainer width="100%" height={300}>
             <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} />
                <Tooltip formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })}/>
                <Legend />
                <Bar dataKey="assets" fill="#3b82f6" name="Assets" />
                <Bar dataKey="liabilities" fill="#f87171" name="Liabilities" />
            </BarChart>
        </ResponsiveContainer>
    );
}


const Analysis: React.FC = () => {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-dark">Financial Analysis</h1>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4">Spending by Category</h3>
                    <SpendingByCategoryChart />
                </div>
                <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4">Income vs. Expense Trend</h3>
                    <IncomeExpenseTrendChart />
                </div>
                 <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4">Asset vs. Liability Growth</h3>
                    <AssetLiabilityChart />
                </div>
            </div>
        </div>
    );
};

export default Analysis;
