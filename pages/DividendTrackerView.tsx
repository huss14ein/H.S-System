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
import { toSAR, getAllInvestmentsValueInSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { unrealizedPnL } from '../services/portfolioMetrics';
import type { Holding } from '../types';
import type { Page } from '../types';
import { approximatePortfolioMWRR, flowsFromInvestmentTransactionsInSAR } from '../services/portfolioXirr';

const DividendTrackerView: React.FC<{ setActivePage?: (page: Page) => void }> = ({ setActivePage: _setActivePage }) => {
    const { data, loading } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const sarPerUsd = useMemo(() => resolveSarPerUsd(data, exchangeRate), [data, exchangeRate]);
    const { formatCurrencyString } = useFormatCurrency();
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiError, setAiError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const { dividendIncomeYTD, monthlyDividendsChartData, recentDividendTransactions, projectedAnnualIncome, averageYield, topPayers, mwrrPct } = useMemo(() => {
        const accounts = (data as any)?.personalAccounts ?? data?.accounts ?? [];
        const personalAccountIds = new Set(accounts.map((a: { id: string }) => a.id));
        const invTxPersonal = (data?.investmentTransactions ?? []).filter((t) => personalAccountIds.has(t.accountId ?? ''));
        const dividendTransactions = invTxPersonal.filter((t) => t.type === 'dividend');
        const now = new Date();

        const dividendIncomeYTD = dividendTransactions
            .filter(t => new Date(t.date).getFullYear() === now.getFullYear())
            .reduce((sum, t) => sum + toSAR(t.total ?? 0, t.currency ?? 'USD', sarPerUsd), 0);

        const monthlyDividends = new Map<string, number>();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        dividendTransactions.filter(t => new Date(t.date) >= twelveMonthsAgo).forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            monthlyDividends.set(monthKey, (monthlyDividends.get(monthKey) || 0) + toSAR(t.total ?? 0, t.currency ?? 'USD', sarPerUsd));
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

        const portfolios = (data as any)?.personalInvestments ?? data?.investments ?? [];
        type HoldingRow = { currentValue?: number; dividendYield?: number; name?: string; symbol?: string; avgCost?: number; quantity?: number };
        const allHoldings = portfolios.flatMap((p: { holdings?: HoldingRow[]; currency?: string }) => ((p.holdings ?? []) as HoldingRow[]).map(h => ({ ...h, portfolioCurrency: p.currency ?? 'USD' }))) as (HoldingRow & { portfolioCurrency?: string })[];
        const totalInvestmentValue = allHoldings.reduce((sum: number, h) => sum + toSAR(h.currentValue ?? 0, (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR', sarPerUsd), 0);

        const holdingsWithProjectedDividends = allHoldings
            .filter(h => {
                const yieldVal = h.dividendYield ?? 0;
                return yieldVal > 0 && Number.isFinite(yieldVal) && yieldVal <= 100; // Validate yield is reasonable
            })
            .map((h) => {
                const holding = h as unknown as Holding;
                const uPnL = unrealizedPnL(holding);
                const costBasis = Math.max(0, Number(holding.avgCost) || 0) * Math.max(0, Number(holding.quantity) || 0);
                const cv = Number(h.currentValue) || 0;
                const dy = Number(h.dividendYield) || 0;
                const annualDivLocal = cv * (dy / 100);
                const yieldOnCostPct = costBasis > 0.01 && annualDivLocal > 0 ? (annualDivLocal / costBasis) * 100 : null;
                return {
                    name: h.name ?? h.symbol ?? '—',
                    projected: toSAR(h.currentValue ?? 0, (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR', sarPerUsd) * (dy / 100),
                    unrealizedSAR: toSAR(uPnL, (h.portfolioCurrency ?? 'USD') as 'USD' | 'SAR', sarPerUsd),
                    forwardYieldPct: dy,
                    yieldOnCostPct,
                };
            });

        const projectedAnnualIncome = holdingsWithProjectedDividends.reduce((sum: number, h: { projected: number }) => sum + h.projected, 0);
        const averageYield = totalInvestmentValue > 0 ? (projectedAnnualIncome / totalInvestmentValue) * 100 : 0;
        const topPayers = holdingsWithProjectedDividends
            .sort((a: { projected: number }, b: { projected: number }) => b.projected - a.projected)
            .slice(0, 5)
            .map((h: { name?: string; projected: number; unrealizedSAR?: number; forwardYieldPct?: number; yieldOnCostPct?: number | null }) => ({
                name: h.name ?? '',
                projected: h.projected,
                unrealizedSAR: h.unrealizedSAR,
                forwardYieldPct: h.forwardYieldPct,
                yieldOnCostPct: h.yieldOnCostPct,
            }));

        const flows = flowsFromInvestmentTransactionsInSAR(invTxPersonal, sarPerUsd);
        const termVal = getAllInvestmentsValueInSAR(portfolios, sarPerUsd);
        const mwrrPct = approximatePortfolioMWRR(flows, termVal, new Date().toISOString().slice(0, 10));

        return {
            dividendIncomeYTD,
            monthlyDividendsChartData,
            recentDividendTransactions,
            projectedAnnualIncome,
            averageYield,
            topPayers,
            mwrrPct,
        };
    }, [data, sarPerUsd]);

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

    if (loading || !data) {
        return (
            <div className="page-container flex items-center justify-center min-h-[24rem]" aria-busy="true">
                <div className="text-center">
                    <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-label="Loading dividend tracker" />
                    <p className="text-sm text-slate-600">Loading dividend data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container space-y-6 sm:space-y-8">
            {/* Hero Section */}
            <div className="section-card p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
                            <TrophyIcon className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <h2 className="page-title text-2xl sm:text-3xl">Dividend Tracker</h2>
                            <p className="text-slate-600 mt-1">Monitor your passive income from dividend-paying investments</p>
                        </div>
                    </div>
                    <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Live data</span>
                </div>
                <div className="mt-6 bg-slate-50 rounded-xl p-6 border border-slate-200">
                    <p className="text-slate-700 leading-relaxed">
                        Track your dividend income year-to-date, view projected annual earnings, and analyze your portfolio&apos;s dividend yield.
                        Get AI-powered insights to optimize your passive income strategy.
                    </p>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="cards-grid grid grid-cols-1 md:grid-cols-3">
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Dividend Income (YTD)</p>
                        <div className="w-10 h-10 bg-success/10 rounded-xl flex items-center justify-center">
                            <TrophyIcon className="h-5 w-5 text-success" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(dividendIncomeYTD)}</p>
                    <p className="text-sm text-slate-600 mt-1">Received so far this year</p>
                </div>
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Projected Annual Income</p>
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                            <BanknotesIcon className="h-5 w-5 text-primary" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{formatCurrencyString(projectedAnnualIncome)}</p>
                    <p className="text-sm text-slate-600 mt-1">Based on current holdings</p>
                </div>
                <div className="section-card">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Average Portfolio Yield</p>
                        <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center">
                            <ArrowTrendingUpIcon className="h-5 w-5 text-secondary" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-dark tabular-nums">{averageYield.toFixed(2)}%</p>
                    <p className="text-sm text-slate-600 mt-1">Annual dividend percentage</p>
                </div>
            </div>

            <div className="section-card border border-violet-100 bg-violet-50/40">
                <p className="text-sm font-semibold text-slate-800">Approx. portfolio MWRR (money-weighted)</p>
                <p className="text-2xl font-bold text-violet-800 tabular-nums mt-1">
                    {mwrrPct != null && Number.isFinite(mwrrPct) ? `${mwrrPct.toFixed(2)}%` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                    IRR on trade totals + terminal book value (account currency mix). Simplified heuristic.
                </p>
            </div>
            
            {/* AI Advisor Section */}
            <div className="section-card">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                            <LightBulbIcon className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="section-title mb-0">Dividend Advisor</h3>
                            <p className="text-sm text-slate-500 mt-0.5">Expert analysis powered by AI</p>
                        </div>
                    </div>
                    <button
                        onClick={handleGetAnalysis}
                        disabled={isLoading}
                        className="btn-primary"
                    >
                        <SparklesIcon className="h-5 w-5" />
                        {isLoading ? 'Analyzing...' : 'Generate Analysis'}
                    </button>
                </div>

                {aiError && (
                    <div className="alert-warning mb-4">
                        <SafeMarkdownRenderer content={aiError} />
                        <button type="button" onClick={handleGetAnalysis} className="btn-ghost mt-3">Retry</button>
                    </div>
                )}

                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                        <p className="text-sm text-slate-600">Analyzing your dividend strategy...</p>
                    </div>
                )}

                {!isLoading && aiAnalysis && (
                    <div className="rounded-xl p-6 border border-slate-200 bg-slate-50/50">
                        <SafeMarkdownRenderer content={aiAnalysis} />
                    </div>
                )}

                {!isLoading && !aiAnalysis && !aiError && (
                    <div className="text-center py-8">
                        <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <LightBulbIcon className="h-7 w-7 text-slate-500" />
                        </div>
                        <p className="text-sm text-slate-600">Click &quot;Generate Analysis&quot; for an expert summary of your dividend income</p>
                    </div>
                )}
            </div>

            {/* Chart Section */}
            <div className="section-card">
                <h3 className="section-title">Monthly Dividend Income</h3>
                <p className="text-sm text-slate-500 mb-4">Last 12 months performance</p>
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

            {/* Bottom Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Dividend Payments */}
                <div className="section-card">
                    <h3 className="section-title">Recent Dividend Payments</h3>
                    <p className="text-sm text-slate-500 mb-4">Latest dividend transactions</p>
                    <div className="overflow-x-auto">
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <table className="min-w-full">
                                <thead className="bg-slate-50">
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
                                className="btn-primary"
                            >
                                Export to CSV
                            </button>
                        </div>
                    )}
                </div>

                {/* Top Dividend Payers */}
                <div className="section-card">
                    <h3 className="section-title">Top 5 Dividend Payers</h3>
                    <p className="text-sm text-slate-500 mb-4">Based on projected annual income</p>
                    <div className="space-y-3">
                        {topPayers.map((payer: { name: string; projected: number; unrealizedSAR?: number; forwardYieldPct?: number; yieldOnCostPct?: number | null }, index: number) => (
                            <div key={payer.name} className="list-row flex-wrap gap-2">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                        index === 0 ? 'bg-amber-100 text-amber-800' :
                                        index === 1 ? 'bg-slate-200 text-slate-700' :
                                        index === 2 ? 'bg-slate-100 text-slate-600' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {index + 1}
                                    </div>
                                    <div>
                                        <span className="font-bold text-slate-900 block">{payer.name}</span>
                                        <span className="text-xs text-slate-500">
                                            Forward yield {Number(payer.forwardYieldPct ?? 0).toFixed(2)}%
                                            {payer.yieldOnCostPct != null && Number.isFinite(payer.yieldOnCostPct) ? (
                                                <> · <strong className="text-violet-700">YoC {payer.yieldOnCostPct.toFixed(2)}%</strong></>
                                            ) : null}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5 text-sm">
                                    <span className="font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg">
                                        {formatCurrencyString(payer.projected)}/yr
                                    </span>
                                    {payer.unrealizedSAR != null && Number.isFinite(payer.unrealizedSAR) && Math.abs(payer.unrealizedSAR) >= 0.01 && (
                                        <span className={`text-xs ${payer.unrealizedSAR >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            Unrealized {payer.unrealizedSAR >= 0 ? '+' : ''}{formatCurrencyString(payer.unrealizedSAR)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    {topPayers.length === 0 && (
                        <div className="empty-state">
                            <p className="font-medium">No holdings with dividend yields found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DividendTrackerView;
