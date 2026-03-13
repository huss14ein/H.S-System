import React, { useMemo, useContext, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import AIAdvisor from '../components/AIAdvisor';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import { CHART_COLORS, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber } from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';
import type { Transaction } from '../types';
import { useCurrency } from '../context/CurrencyContext';
import { getAllInvestmentsValueInSAR } from '../utils/currencyMath';
import InfoHint from '../components/InfoHint';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { ArrowTrendingDownIcon } from '../components/icons/ArrowTrendingDownIcon';
import { ChartBarIcon } from '../components/icons/ChartBarIcon';
import { InformationCircleIcon } from '../components/icons/InformationCircleIcon';
import { ArrowDownTrayIcon } from '../components/icons/ArrowDownTrayIcon';
import Card from '../components/Card';

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
    try {
        const monthMap = new Map<string, { income: number; expenses: number }>();
        const now = new Date();
        for (let i = months - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthMap.set(getMonthKey(d), { income: 0, expenses: 0 });
        }

        transactions.forEach((t) => {
            try {
                const key = getMonthKey(t.date);
                if (!monthMap.has(key)) return;
                const current = monthMap.get(key)!;
                const amount = Math.abs(Number(t.amount) || 0);
                if (isIncomeTx(t) && Number.isFinite(amount)) {
                    current.income += amount;
                }
                if (isExpenseTx(t) && Number.isFinite(amount)) {
                    current.expenses += amount;
                }
                monthMap.set(key, current);
            } catch (e) {
                // Skip invalid transactions
            }
        });

        return Array.from(monthMap.entries()).map(([key, value]) => ({
            monthKey: key,
            name: monthLabel(key),
            income: Math.max(0, value.income),
            expenses: Math.max(0, value.expenses),
        }));
    } catch (error) {
        console.error('Error building trend data:', error);
        return [];
    }
};

type TimePeriod = '3M' | '6M' | '12M' | 'All';

const SpendingByCategoryChart: React.FC<{ timePeriod?: TimePeriod }> = ({ timePeriod = 'All' }) => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    
    const chartData = useMemo(() => {
        try {
            const transactions = data?.transactions ?? [];
            const now = new Date();
            let filteredTransactions = transactions.filter(isExpenseTx);
            
            // Filter by time period
            if (timePeriod !== 'All') {
                const months = timePeriod === '3M' ? 3 : timePeriod === '6M' ? 6 : 12;
                const cutoffDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
                filteredTransactions = filteredTransactions.filter(t => {
                    try {
                        return new Date(t.date) >= cutoffDate;
                    } catch {
                        return false;
                    }
                });
            }
            
            const spending = new Map<string, number>();
            filteredTransactions.forEach((t) => {
                try {
                    const rawCategory = (t.budgetCategory || t.category || 'Uncategorized').trim();
                    const category = rawCategory.length > 0 ? rawCategory : 'Uncategorized';
                    const amount = Math.abs(Number(t.amount) || 0);
                    if (Number.isFinite(amount) && amount > 0) {
                        spending.set(category, (spending.get(category) || 0) + amount);
                    }
                } catch (e) {
                    // Skip invalid transactions
                }
            });
            
            return Array.from(spending, ([name, value]) => ({ name, value }))
                .filter((x) => Number.isFinite(x.value) && x.value > 0)
                .sort((a, b) => b.value - a.value);
        } catch (error) {
            console.error('Error building spending chart data:', error);
            return [];
        }
    }, [data?.transactions, timePeriod]);
    
    const isEmpty = !chartData.length;
    const totalSpending = chartData.reduce((sum, item) => sum + item.value, 0);
    const topCategory = chartData[0];
    const topCategoryPercent = totalSpending > 0 ? (topCategory?.value || 0) / totalSpending * 100 : 0;

    return (
        <>
            {!isEmpty && (
                <div className="mb-3 p-3 bg-slate-50 rounded-lg grid grid-cols-3 gap-3 text-sm">
                    <div>
                        <p className="text-xs text-slate-500">Total Spending</p>
                        <p className="font-semibold text-dark">{formatCurrencyString(totalSpending, { digits: 0 })}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Categories</p>
                        <p className="font-semibold text-dark">{chartData.length}</p>
                    </div>
                    {topCategory && (
                        <div>
                            <p className="text-xs text-slate-500">Top Category</p>
                            <p className="font-semibold text-dark truncate" title={topCategory.name}>
                                {topCategory.name}
                            </p>
                            <p className="text-xs text-slate-600">{topCategoryPercent.toFixed(1)}%</p>
                        </div>
                    )}
                </div>
            )}
            <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No spending-by-category data yet. Add expense transactions with categories.">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie 
                            data={chartData} 
                            dataKey="value" 
                            nameKey="name" 
                            cx="50%" 
                            cy="50%" 
                            outerRadius={selectedCategory ? 120 : 100} 
                            paddingAngle={2}
                            onClick={(data) => setSelectedCategory(selectedCategory === data.name ? null : data.name)}
                            style={{ cursor: 'pointer' }}
                        >
                            {chartData.map((entry, index) => (
                                <Cell 
                                    key={`cell-${index}`} 
                                    fill={
                                        selectedCategory === entry.name 
                                            ? CHART_COLORS.primary 
                                            : CHART_COLORS.categorical[index % CHART_COLORS.categorical.length]
                                    } 
                                    stroke="white" 
                                    strokeWidth={selectedCategory === entry.name ? 3 : 1}
                                    opacity={selectedCategory && selectedCategory !== entry.name ? 0.3 : 1}
                                />
                            ))}
                        </Pie>
                        <Tooltip 
                            formatter={(value, name) => [
                                formatCurrencyString(Number(value), { digits: 0 }),
                                `${name} (${totalSpending > 0 ? ((Number(value) / totalSpending) * 100).toFixed(1) : 0}%)`
                            ]} 
                            contentStyle={TOOLTIP_STYLE} 
                        />
                        <Legend 
                            iconType="circle" 
                            iconSize={8} 
                            wrapperStyle={{ fontSize: 12 }}
                            onClick={(e) => setSelectedCategory(selectedCategory === e.value ? null : e.value)}
                            style={{ cursor: 'pointer' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </ChartContainer>
            {selectedCategory && (
                <div className="mt-3 p-2 bg-primary/10 border border-primary/20 rounded-lg">
                    <p className="text-xs text-slate-600">
                        Selected: <span className="font-semibold text-primary">{selectedCategory}</span> - 
                        {chartData.find(c => c.name === selectedCategory) && (
                            <span className="ml-1">
                                {formatCurrencyString(chartData.find(c => c.name === selectedCategory)!.value, { digits: 0 })} 
                                ({((chartData.find(c => c.name === selectedCategory)!.value / totalSpending) * 100).toFixed(1)}%)
                            </span>
                        )}
                    </p>
                </div>
            )}
        </>
    );
};

const IncomeExpenseTrendChart: React.FC<{ timePeriod?: TimePeriod }> = ({ timePeriod = '6M' }) => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();
    
    const months = timePeriod === '3M' ? 3 : timePeriod === '6M' ? 6 : timePeriod === '12M' ? 12 : 24;
    const chartData = useMemo(() => buildTrendData(data?.transactions ?? [], months), [data?.transactions, months]);
    const hasSignal = chartData.some((x) => x.income > 0 || x.expenses > 0);
    const isEmpty = !hasSignal;
    
    const summary = useMemo(() => {
        if (isEmpty) return null;
        const totalIncome = chartData.reduce((sum, d) => sum + d.income, 0);
        const totalExpenses = chartData.reduce((sum, d) => sum + d.expenses, 0);
        const avgIncome = totalIncome / chartData.length;
        const avgExpenses = totalExpenses / chartData.length;
        const netSavings = totalIncome - totalExpenses;
        const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;
        
        // Calculate trend (compare last month to previous)
        const lastMonth = chartData[chartData.length - 1];
        const prevMonth = chartData[chartData.length - 2];
        const incomeTrend = prevMonth && prevMonth.income > 0 
            ? ((lastMonth.income - prevMonth.income) / prevMonth.income) * 100 
            : 0;
        const expenseTrend = prevMonth && prevMonth.expenses > 0 
            ? ((lastMonth.expenses - prevMonth.expenses) / prevMonth.expenses) * 100 
            : 0;
        
        return {
            totalIncome,
            totalExpenses,
            avgIncome,
            avgExpenses,
            netSavings,
            savingsRate,
            incomeTrend,
            expenseTrend,
        };
    }, [chartData, isEmpty]);

    return (
        <>
            {summary && (
                <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                        <p className="text-xs text-emerald-700">Avg Income</p>
                        <p className="font-semibold text-emerald-800">{formatCurrencyString(summary.avgIncome, { digits: 0 })}</p>
                        {summary.incomeTrend !== 0 && (
                            <p className={`text-xs flex items-center gap-1 mt-0.5 ${summary.incomeTrend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {summary.incomeTrend >= 0 ? <ArrowTrendingUpIcon className="h-3 w-3" /> : <ArrowTrendingDownIcon className="h-3 w-3" />}
                                {Math.abs(summary.incomeTrend).toFixed(1)}%
                            </p>
                        )}
                    </div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs text-red-700">Avg Expenses</p>
                        <p className="font-semibold text-red-800">{formatCurrencyString(summary.avgExpenses, { digits: 0 })}</p>
                        {summary.expenseTrend !== 0 && (
                            <p className={`text-xs flex items-center gap-1 mt-0.5 ${summary.expenseTrend <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {summary.expenseTrend <= 0 ? <ArrowTrendingDownIcon className="h-3 w-3" /> : <ArrowTrendingUpIcon className="h-3 w-3" />}
                                {Math.abs(summary.expenseTrend).toFixed(1)}%
                            </p>
                        )}
                    </div>
                    <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-xs text-blue-700">Net Savings</p>
                        <p className={`font-semibold ${summary.netSavings >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                            {summary.netSavings >= 0 ? '+' : ''}{formatCurrencyString(summary.netSavings, { digits: 0 })}
                        </p>
                    </div>
                    <div className="p-2 bg-purple-50 rounded-lg border border-purple-200">
                        <p className="text-xs text-purple-700">Savings Rate</p>
                        <p className={`font-semibold ${summary.savingsRate >= 20 ? 'text-emerald-800' : summary.savingsRate >= 10 ? 'text-yellow-800' : 'text-red-800'}`}>
                            {summary.savingsRate.toFixed(1)}%
                        </p>
                    </div>
                </div>
            )}
            <ChartContainer height={300} isEmpty={isEmpty} emptyMessage={`No income/expense trend for the last ${months} months.`}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip 
                            formatter={(value, name) => [
                                formatCurrencyString(Number(value), { digits: 0 }),
                                name
                            ]} 
                            contentStyle={TOOLTIP_STYLE}
                            labelFormatter={(label) => `Month: ${label}`}
                        />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <Line 
                            type="monotone" 
                            dataKey="income" 
                            stroke={CHART_COLORS.positive} 
                            strokeWidth={2} 
                            name="Income" 
                            dot={{ fill: CHART_COLORS.positive, r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                        <Line 
                            type="monotone" 
                            dataKey="expenses" 
                            stroke={CHART_COLORS.negative} 
                            strokeWidth={2} 
                            name="Expenses" 
                            dot={{ fill: CHART_COLORS.negative, r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </ChartContainer>
        </>
    );
};

const AssetLiabilityChart: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    
    const chartData = useMemo(() => {
        try {
            const inv = data?.investments ?? [];
            const acc = data?.accounts ?? [];
            const ast = data?.assets ?? [];
            const liab = data?.liabilities ?? [];

            const totalInvestments = Math.max(0, getAllInvestmentsValueInSAR(inv, exchangeRate));
            const totalCash = Math.max(0, acc
                .filter(a => a.type !== 'Credit')
                .reduce((sum, a) => sum + Math.max(0, Number(a.balance) || 0), 0));
            const totalPhysicalAssets = Math.max(0, ast
                .reduce((sum, asset) => sum + Math.max(0, Number(asset.value) || 0), 0));
            const totalDebt = Math.max(0, liab
                .filter((l) => (Number(l.amount) || 0) < 0)
                .reduce((sum, l) => sum + Math.abs(Number(l.amount) || 0), 0)
                + acc
                    .filter(a => a.type === 'Credit' && (Number(a.balance) || 0) < 0)
                    .reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0));
            const totalReceivable = Math.max(0, liab
                .filter((l) => (Number(l.amount) || 0) > 0 || l.type === 'Receivable')
                .reduce((sum, l) => sum + Math.max(0, Number(l.amount) || 0), 0));

            return [
                { name: 'Investments', value: totalInvestments },
                { name: 'Cash', value: totalCash },
                { name: 'Physical Assets', value: totalPhysicalAssets },
                { name: 'Receivables', value: totalReceivable },
                { name: 'Debt', value: totalDebt },
            ];
        } catch (error) {
            console.error('Error building asset/liability chart data:', error);
            return [];
        }
    }, [data, exchangeRate]);

    const hasSignal = chartData.some((x) => x.value > 0);
    const isEmpty = !hasSignal;
    const getBarColor = (name: string) => name === 'Debt' ? CHART_COLORS.liability : name === 'Receivables' ? CHART_COLORS.positive : CHART_COLORS.primary;
    
    const summary = useMemo(() => {
        if (isEmpty) return null;
        const totalAssets = chartData
            .filter(d => d.name !== 'Debt')
            .reduce((sum, d) => sum + d.value, 0);
        const totalDebt = chartData.find(d => d.name === 'Debt')?.value || 0;
        const netWorth = totalAssets - totalDebt;
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
        
        return {
            totalAssets,
            totalDebt,
            netWorth,
            debtToAssetRatio,
        };
    }, [chartData, isEmpty]);

    return (
        <>
            {summary && (
                <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card 
                        title="Total Assets" 
                        value={formatCurrencyString(summary.totalAssets, { digits: 0 })} 
                        valueColor="text-success"
                        density="compact"
                    />
                    <Card 
                        title="Total Debt" 
                        value={formatCurrencyString(summary.totalDebt, { digits: 0 })} 
                        valueColor="text-danger"
                        density="compact"
                    />
                    <Card 
                        title="Net Worth" 
                        value={formatCurrencyString(summary.netWorth, { digits: 0 })} 
                        valueColor={summary.netWorth >= 0 ? 'text-success' : 'text-danger'}
                        density="compact"
                    />
                    <Card 
                        title="Debt Ratio" 
                        value={`${summary.debtToAssetRatio.toFixed(1)}%`} 
                        valueColor={summary.debtToAssetRatio < 30 ? 'text-success' : summary.debtToAssetRatio < 50 ? 'text-yellow-600' : 'text-danger'}
                        density="compact"
                        tooltip="Debt as percentage of total assets"
                    />
                </div>
            )}
            <ChartContainer height={300} isEmpty={isEmpty} emptyMessage="No assets/liabilities available yet. Add accounts, investments, assets, and liabilities to see your financial position.">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip 
                            formatter={(value) => formatCurrencyString(Number(value), { digits: 0 })} 
                            contentStyle={TOOLTIP_STYLE}
                            labelFormatter={(label) => `${label}`}
                        />
                        <Bar dataKey="value" name="Value" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry) => (
                                <Cell key={`cell-${entry.name}`} fill={getBarColor(entry.name)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartContainer>
        </>
    );
};

const Analysis: React.FC = () => {
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [spendingTimePeriod, setSpendingTimePeriod] = useState<TimePeriod>('All');
    const [trendTimePeriod, setTrendTimePeriod] = useState<TimePeriod>('6M');

    const contextData = useMemo(() => {
        try {
            const transactions = data?.transactions ?? [];
            const investments = data?.investments ?? [];
            const accounts = data?.accounts ?? [];
            const assets = data?.assets ?? [];
            const liabilities = data?.liabilities ?? [];

            const spendingMap = new Map<string, number>();
            transactions.filter(isExpenseTx).forEach((t) => {
                try {
                    const category = (t.budgetCategory || t.category || 'Uncategorized').trim() || 'Uncategorized';
                    const amount = Math.abs(Number(t.amount) || 0);
                    if (Number.isFinite(amount) && amount > 0) {
                        spendingMap.set(category, (spendingMap.get(category) || 0) + amount);
                    }
                } catch (e) {
                    // Skip invalid transactions
                }
            });
            const spendingData = Array.from(spendingMap, ([name, value]) => ({ name, value }))
                .filter((x) => Number.isFinite(x.value) && x.value > 0)
                .sort((a, b) => b.value - a.value);

            const trendData = buildTrendData(transactions, 6);

            const totalInvestments = Math.max(0, getAllInvestmentsValueInSAR(investments, exchangeRate));
            const totalCash = Math.max(0, accounts
                .filter(a => a.type !== 'Credit')
                .reduce((sum, acc) => sum + Math.max(0, Number(acc.balance) || 0), 0));
            const totalPhysicalAssets = Math.max(0, assets
                .reduce((sum, asset) => sum + Math.max(0, Number(asset.value) || 0), 0));
            const totalDebt = Math.max(0, liabilities
                .filter((l) => (Number(l.amount) || 0) < 0)
                .reduce((sum, liab) => sum + Math.abs(Number(liab.amount) || 0), 0)
                + accounts
                    .filter(a => a.type === 'Credit' && (Number(a.balance) || 0) < 0)
                    .reduce((sum, acc) => sum + Math.abs(Number(acc.balance) || 0), 0));
            const totalReceivable = Math.max(0, liabilities
                .filter((l) => (Number(l.amount) || 0) > 0 || l.type === 'Receivable')
                .reduce((sum, liab) => sum + Math.max(0, Number(liab.amount) || 0), 0));
            const compositionData = [
                { name: 'Investments', value: totalInvestments },
                { name: 'Cash', value: totalCash },
                { name: 'Physical Assets', value: totalPhysicalAssets },
                { name: 'Receivables', value: totalReceivable },
                { name: 'Debt', value: totalDebt },
            ];

            return { spendingData, trendData, compositionData };
        } catch (error) {
            console.error('Error building context data:', error);
            return { spendingData: [], trendData: [], compositionData: [] };
        }
    }, [data, exchangeRate]);

    const handleExportData = useCallback(() => {
        try {
            const exportData = {
                spendingByCategory: contextData.spendingData,
                trendData: contextData.trendData,
                compositionData: contextData.compositionData,
                exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `financial-analysis-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting data:', error);
        }
    }, [contextData]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <PageLayout 
            title="Financial Analysis"
            description="Comprehensive analysis of your spending patterns, income trends, and financial position."
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={handleExportData}
                        className="text-xs px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                        title="Export analysis data"
                    >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        Export Data
                    </button>
                </div>
            }
        >
            <AIAdvisor pageContext="analysis" contextData={contextData} />

            {/* Quick Stats Summary */}
            {contextData.spendingData.length > 0 && (
                <div className="section-card mb-6 border-l-4 border-primary">
                    <h3 className="section-title mb-3">Quick Insights</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500">Top Spending Category</p>
                            <p className="font-semibold text-dark mt-1 truncate" title={contextData.spendingData[0]?.name}>
                                {contextData.spendingData[0]?.name || 'N/A'}
                            </p>
                            {contextData.spendingData[0] && (
                                <p className="text-xs text-slate-600 mt-0.5">
                                    {formatCurrencyString(contextData.spendingData[0].value, { digits: 0 })}
                                </p>
                            )}
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500">Total Categories</p>
                            <p className="font-semibold text-dark mt-1">{contextData.spendingData.length}</p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500">Total Spending</p>
                            <p className="font-semibold text-dark mt-1">
                                {formatCurrencyString(
                                    contextData.spendingData.reduce((sum, item) => sum + item.value, 0),
                                    { digits: 0 }
                                )}
                            </p>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500">Avg per Category</p>
                            <p className="font-semibold text-dark mt-1">
                                {formatCurrencyString(
                                    contextData.spendingData.length > 0
                                        ? contextData.spendingData.reduce((sum, item) => sum + item.value, 0) / contextData.spendingData.length
                                        : 0,
                                    { digits: 0 }
                                )}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2 mt-6">
                <SectionCard 
                    title={
                        <div className="flex items-center justify-between w-full">
                            <span className="flex items-center gap-2">
                                Spending by Budget Category
                                <InfoHint text="Click on a category in the legend or chart to highlight it. Shows your spending breakdown by category." />
                            </span>
                            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                                {(['3M', '6M', '12M', 'All'] as TimePeriod[]).map(period => (
                                    <button
                                        key={period}
                                        type="button"
                                        onClick={() => setSpendingTimePeriod(period)}
                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                            spendingTimePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        {period}
                                    </button>
                                ))}
                            </div>
                        </div>
                    } 
                    className="min-h-[480px] flex flex-col"
                >
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <SpendingByCategoryChart timePeriod={spendingTimePeriod} />
                    </div>
                </SectionCard>
                <SectionCard 
                    title={
                        <div className="flex items-center justify-between w-full">
                            <span className="flex items-center gap-2">
                                Monthly Income vs. Expense
                                <InfoHint text="Track your income and expenses over time. Shows average values and trends." />
                            </span>
                            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                                {(['3M', '6M', '12M', 'All'] as TimePeriod[]).map(period => (
                                    <button
                                        key={period}
                                        type="button"
                                        onClick={() => setTrendTimePeriod(period)}
                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                            trendTimePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        {period}
                                    </button>
                                ))}
                            </div>
                        </div>
                    } 
                    className="min-h-[480px] flex flex-col"
                >
                    <div className="flex-1 min-h-[300px] rounded-lg overflow-hidden">
                        <IncomeExpenseTrendChart timePeriod={trendTimePeriod} />
                    </div>
                </SectionCard>
                <SectionCard 
                    title={
                        <div className="flex items-center gap-2">
                            Current Financial Position
                            <InfoHint text="Overview of your assets and liabilities. Net worth = Total Assets - Total Debt." />
                        </div>
                    } 
                    className="lg:col-span-2 min-h-[480px] flex flex-col"
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
