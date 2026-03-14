import React, { useState, useContext, useMemo, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from '../components/charts/chartTheme';
import ChartContainer from '../components/charts/ChartContainer';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { getAIDividendAnalysis, formatAiError } from '../services/geminiService';
import { LightBulbIcon } from '../components/icons/LightBulbIcon';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';

const DividendTrackerView: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiError, setAiError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    
    // Loading state
    if (!data) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-sm text-slate-600">Loading dividend data...</p>
                </div>
            </div>
        );
    }

    const { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions, projectedAnnualIncome, averageYield, topPayers } = useMemo(() => {
        const dividendTransactions = (data?.investmentTransactions ?? []).filter(t => t.type === 'dividend');
        const now = new Date();

        const dividendIncomeYTD = dividendTransactions
            .filter(t => new Date(t.date).getFullYear() === now.getFullYear())
            .reduce((sum, t) => sum + toSAR(t.total ?? 0, t.currency ?? 'USD', exchangeRate), 0);

        const monthlyDividends = new Map<string, number>();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dividendTransactions.filter(t => new Date(t.date) >= twelveMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            monthlyDividends.set(monthKey, (monthlyDividends.get(monthKey) || 0) + toSAR(t.total ?? 0, t.currency ?? 'USD', exchangeRate));
        });
        
        const monthlyDividendsChartData = Array.from(monthlyDividends.entries()).sort((a,b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ 
            name: new Date(key + '-02').toLocaleString('default', { month: 'short', year: '2-digit' }), 
            "Dividend Income": value 
        }));

        const recentDividendTransactions = dividendTransactions
            .filter(t => {
                const txDate = new Date(t.date);
                return !isNaN(txDate.getTime());
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10);

        const allHoldings = (data?.investments ?? []).flatMap(p => (p.holdings ?? []).map(h => ({ ...h, portfolioCurrency: p.currency ?? 'USD' })));
        const totalInvestmentValue = allHoldings.reduce((sum, h) => sum + toSAR(h.currentValue ?? 0, h.portfolioCurrency ?? 'USD', exchangeRate), 0);

        const holdingsWithProjectedDividends = allHoldings
            .filter(h => {
                const yieldVal = h.dividendYield ?? 0;
                return yieldVal > 0 && Number.isFinite(yieldVal) && yieldVal <= 100; // Validate yield is reasonable
            })
            .map(h => ({
                name: h.name ?? h.symbol ?? '—',
                projected: toSAR(h.currentValue ?? 0, h.portfolioCurrency ?? 'USD', exchangeRate) * ((h.dividendYield ?? 0) / 100),
            }));

        const projectedAnnualIncome = holdingsWithProjectedDividends.reduce((sum, h) => sum + h.projected, 0);
        const averageYield = totalInvestmentValue > 0 ? (projectedAnnualIncome / totalInvestmentValue) * 100 : 0;
        const topPayers = holdingsWithProjectedDividends
            .sort((a, b) => b.projected - a.projected)
            .slice(0, 5)
            .map((h) => ({ name: h.name ?? '', projected: h.projected }));

        return { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions, projectedAnnualIncome, averageYield, topPayers };
    }, [data, exchangeRate]);

    const handleGetAnalysis = useCallback(async () => {
        setIsLoading(true);
        setAiError(null);
        try {
            const analysis = await getAIDividendAnalysis(dividendIncomeYTD, projectedAnnualIncome, topPayers);
            setAiAnalysis(analysis);
        } catch (err) {
            setAiError(formatAiError(err));
            setAiAnalysis('');
        } finally {
            setIsLoading(false);
        }
    }, [dividendIncomeYTD, projectedAnnualIncome, topPayers]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
            {/* Enhanced Hero Section */}
            <div className="rounded-3xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-8 shadow-xl mb-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <TrophyIcon className="h-8 w-8 text-white" />
                        </div>
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900">Dividend Tracker</h2>
                            <p className="text-lg text-slate-600 mt-2">Monitor your passive income from dividend-paying investments</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-bold text-emerald-700 uppercase tracking-wider">Live Tracking</span>
                    </div>
                </div>
                <div className="mt-6 bg-gradient-to-r from-emerald-50 to-green-50 rounded-2xl p-6 border border-emerald-100">
                    <p className="text-slate-700 leading-relaxed">
                        Track your dividend income year-to-date, view projected annual earnings, and analyze your portfolio's dividend yield. 
                        Get AI-powered insights to optimize your passive income strategy.
                    </p>
                </div>
            </div>

            {/* Enhanced Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <TrophyIcon className="h-7 w-7 text-white" />
                        </div>
                        <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-2">Dividend Income (YTD)</p>
                    <p className="text-4xl font-black text-emerald-900 tabular-nums">{formatCurrencyString(dividendIncomeYTD)}</p>
                    <p className="text-sm text-emerald-700 mt-2">Received so far this year</p>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <BanknotesIcon className="h-7 w-7 text-white" />
                        </div>
                        <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-indigo-800 uppercase tracking-wider mb-2">Projected Annual Income</p>
                    <p className="text-4xl font-black text-indigo-900 tabular-nums">{formatCurrencyString(projectedAnnualIncome)}</p>
                    <p className="text-sm text-indigo-700 mt-2">Based on current holdings</p>
                </div>
                <div className="bg-gradient-to-br from-violet-50 to-purple-50 border-2 border-violet-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <ArrowTrendingUpIcon className="h-7 w-7 text-white" />
                        </div>
                        <div className="w-3 h-3 bg-violet-500 rounded-full animate-pulse"></div>
                    </div>
                    <p className="text-sm font-bold text-violet-800 uppercase tracking-wider mb-2">Average Portfolio Yield</p>
                    <p className="text-4xl font-black text-violet-900 tabular-nums">{averageYield.toFixed(2)}%</p>
                    <p className="text-sm text-violet-700 mt-2">Annual dividend percentage</p>
                </div>
            </div>
            
            {/* Enhanced AI Advisor Section */}
            <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-8 shadow-lg hover:shadow-xl transition-all duration-300 mb-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                            <LightBulbIcon className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-indigo-900">Dividend Advisor</h3>
                            <p className="text-sm text-indigo-600 mt-1">Expert analysis powered by AI</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleGetAnalysis} 
                        disabled={isLoading} 
                        className="flex items-center px-6 py-3 text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 transition-all duration-200 shadow-md hover:shadow-lg disabled:cursor-not-allowed"
                    >
                        <SparklesIcon className="h-5 w-5 mr-2"/>
                        {isLoading ? 'Analyzing...' : 'Generate Analysis'}
                    </button>
                </div>
                
                {aiError && (
                    <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-6 mb-4">
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-bold text-sm">!</span>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm text-amber-800 font-medium leading-relaxed mb-3">
                                    <SafeMarkdownRenderer content={aiError} />
                                </p>
                                <button 
                                    type="button" 
                                    onClick={handleGetAnalysis} 
                                    className="px-4 py-2 text-sm font-bold bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors duration-200"
                                >
                                    Retry
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 bg-indigo-200 rounded-full animate-pulse mb-4"></div>
                        <p className="text-sm text-indigo-600 font-medium">Analyzing your dividend strategy...</p>
                    </div>
                )}
                
                {!isLoading && aiAnalysis && (
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-indigo-100">
                        <SafeMarkdownRenderer content={aiAnalysis} />
                    </div>
                )}
                
                {!isLoading && !aiAnalysis && !aiError && (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <LightBulbIcon className="h-8 w-8 text-indigo-400" />
                        </div>
                        <p className="text-sm text-indigo-600 font-medium">Click "Generate Analysis" for an expert summary of your dividend income</p>
                    </div>
                )}
            </div>

            {/* Enhanced Chart Section */}
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-8 shadow-lg hover:shadow-xl transition-all duration-300 mb-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-bold text-lg">📊</span>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">Monthly Dividend Income</h3>
                            <p className="text-sm text-slate-600 mt-1">Last 12 months performance</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-slate-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">Live Data</span>
                    </div>
                </div>
                <div className="h-[400px]">
                    <ChartContainer 
                        height="100%" 
                        isEmpty={!monthlyDividendsChartData?.length} 
                        emptyMessage="No dividend income data for the last 12 months." 
                        className="flex-1 min-h-0"
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyDividendsChartData} margin={CHART_MARGIN}>
                                <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                                <YAxis 
                                    tickFormatter={(v) => formatAxisNumber(Number(v))} 
                                    stroke={CHART_AXIS_COLOR} 
                                    fontSize={12} 
                                    tickLine={false} 
                                    width={48} 
                                />
                                <Tooltip
                                    formatter={(val: number) => formatCurrencyString(val, { digits: 2 })}
                                    contentStyle={{ 
                                        backgroundColor: 'white', 
                                        border: '2px solid #e2e8f0', 
                                        borderRadius: '12px', 
                                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', 
                                        padding: '12px 16px' 
                                    }}
                                />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                <Bar 
                                    dataKey="Dividend Income" 
                                    fill={CHART_COLORS.secondary} 
                                    name="Dividend Income" 
                                    radius={[6, 6, 0, 0]} 
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartContainer>
                </div>
            </div>

            {/* Enhanced Bottom Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Dividend Payments */}
                <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-8 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center shadow-lg">
                                <span className="text-white font-bold text-lg">💰</span>
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-900">Recent Dividend Payments</h3>
                                <p className="text-sm text-slate-600 mt-1">Latest dividend transactions</p>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <table className="min-w-full">
                                <thead className="bg-gradient-to-r from-slate-100 to-slate-200">
                                    <tr className="text-left">
                                        <th className="px-4 py-3 font-bold text-slate-700 text-sm uppercase tracking-wider">Date</th>
                                        <th className="px-4 py-3 font-bold text-slate-700 text-sm uppercase tracking-wider">Symbol</th>
                                        <th className="px-4 py-3 text-right font-bold text-slate-700 text-sm uppercase tracking-wider">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100">
                                    {recentDividendTransactions.map(t => (
                                        <tr key={t.id} className="hover:bg-slate-50 transition-colors duration-150">
                                            <td className="px-4 py-3 text-sm text-slate-900 font-medium">
                                                {new Date(t.date).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-800 font-bold text-sm">
                                                    {t.symbol}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="inline-flex items-center px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-sm">
                                                    {formatCurrencyString(t.total ?? 0)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {recentDividendTransactions.length === 0 && (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-gradient-to-br from-slate-100 to-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                                <span className="text-slate-400 text-2xl">📭</span>
                            </div>
                            <p className="text-slate-500 font-medium">No dividend transactions recorded</p>
                        </div>
                    )}
                    {recentDividendTransactions.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <button
                                type="button"
                                onClick={() => {
                                    const csv = [
                                        ['Date', 'Symbol', 'Amount'].join(','),
                                        ...recentDividendTransactions.map(t => [
                                            t.date,
                                            t.symbol,
                                            t.total ?? 0
                                        ].join(','))
                                    ].join('\n');
                                    const blob = new Blob([csv], { type: 'text/csv' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `dividend-transactions-${new Date().toISOString().split('T')[0]}.csv`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                }}
                                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                            >
                                Export to CSV
                            </button>
                        </div>
                    )}
                </div>

                {/* Top Dividend Payers */}
                <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-8 shadow-lg hover:shadow-xl transition-all duration-300">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                                <TrophyIcon className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-emerald-900">Top 5 Dividend Payers</h3>
                                <p className="text-sm text-emerald-600 mt-1">Based on projected annual income</p>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {topPayers.map((payer, index) => (
                            <div key={payer.name} className="flex justify-between items-center p-4 rounded-xl bg-white/70 backdrop-blur-sm border border-emerald-100 hover:bg-white hover:shadow-md transition-all duration-200">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                        index === 0 ? 'bg-yellow-400 text-yellow-900' :
                                        index === 1 ? 'bg-gray-300 text-gray-700' :
                                        index === 2 ? 'bg-amber-600 text-amber-100' :
                                        'bg-emerald-200 text-emerald-800'
                                    }`}>
                                        {index + 1}
                                    </div>
                                    <span className="font-bold text-slate-900">{payer.name}</span>
                                </div>
                                <span className="font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-lg">
                                    {formatCurrencyString(payer.projected)}/yr
                                </span>
                            </div>
                        ))}
                    </div>
                    {topPayers.length === 0 && (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-gradient-to-br from-emerald-100 to-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <span className="text-emerald-400 text-2xl">📊</span>
                            </div>
                            <p className="text-emerald-600 font-medium">No holdings with dividend yields found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DividendTrackerView;
