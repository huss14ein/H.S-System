import React, { useMemo, useContext, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { Holding } from '../types';
import AllocationBarChart from '../components/charts/AllocationBarChart';
import { getAIInvestmentOverviewAnalysis, formatAiError } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';
import { useAI } from '../context/AiContext';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { useCurrency } from '../context/CurrencyContext';
import { toSAR } from '../utils/currencyMath';

type InvestmentSubPage = 'Overview' | 'Portfolios' | 'Investment Plan' | 'Recovery Plan' | 'Watchlist' | 'AI Rebalancer' | 'Dividend Tracker' | 'Execution History';

const InvestmentOverview: React.FC<{ setActiveTab?: (tab: InvestmentSubPage) => void }> = ({ setActiveTab }) => {
    const { data, loading } = useContext(DataContext)!;
    const { isAiAvailable } = useAI();
    const { exchangeRate } = useCurrency();

    const { allHoldingsWithGains, assetClassAllocation, portfolioAllocation } = useMemo(() => {
        const investments = (data as any)?.personalInvestments ?? data?.investments ?? [];
        const allHoldings: (Holding & { portfolioCurrency?: 'USD' | 'SAR' })[] = investments.flatMap((p: { holdings?: Holding[]; currency?: 'USD' | 'SAR' }) =>
            (p.holdings || []).map((h: Holding) => ({ ...h, portfolioCurrency: p.currency })),
        );

        const allHoldingsWithGains = allHoldings
            .map((h) => {
                const qty = Number(h.quantity || 0);
                const avgCost = Number(h.avgCost || 0);
                const marketValue = Number(h.currentValue || 0);
                const costValue = avgCost * qty;
                const effectiveValue = marketValue > 0 ? marketValue : (costValue > 0 ? costValue : 0);
                const effectiveValueSar = toSAR(effectiveValue, h.portfolioCurrency, exchangeRate);
                const costValueSar = toSAR(costValue, h.portfolioCurrency, exchangeRate);
                const gainLossSar = effectiveValueSar - costValueSar;
                const gainLossPercentSar = costValueSar > 0 ? (gainLossSar / costValueSar) * 100 : 0;
                return { ...h, currentValue: effectiveValueSar, gainLoss: gainLossSar, gainLossPercent: gainLossPercentSar };
            })
            .filter((h) => Number.isFinite(h.currentValue) && h.currentValue > 0);

        const assetAllocationMap = new Map<string, number>();
        allHoldingsWithGains.forEach((h) => {
            const assetClass = h.assetClass || 'Other';
            assetAllocationMap.set(assetClass, (assetAllocationMap.get(assetClass) || 0) + h.currentValue);
        });
        const assetClassAllocation = Array.from(assetAllocationMap, ([name, value]: [string, number]) => ({ name, value }))
            .filter((x: { name: string; value: number }) => Number.isFinite(x.value) && x.value > 0)
            .sort((a: { value: number }, b: { value: number }) => b.value - a.value);

        const portfolioAllocation = investments
            .map((p: { name?: string; currency?: string; holdings?: { quantity?: number; avgCost?: number; currentValue?: number }[] }) => {
                const portfolioValue = (p.holdings || []).reduce((sum: number, h: { quantity?: number; avgCost?: number; currentValue?: number }) => {
                    const qty = Number(h.quantity || 0);
                    const avgCost = Number(h.avgCost || 0);
                    const marketValue = Number(h.currentValue || 0);
                    const fallbackValue = avgCost * qty;
                    const effectiveValue = marketValue > 0 ? marketValue : (fallbackValue > 0 ? fallbackValue : 0);
                    return sum + effectiveValue;
                }, 0);
                return { name: p.name, value: toSAR(portfolioValue, (p.currency ?? 'USD') as 'USD' | 'SAR', exchangeRate) };
            })
            .filter((x: { name?: string; value: number }) => Number.isFinite(x.value) && x.value > 0)
            .sort((a: { value: number }, b: { value: number }) => b.value - a.value);

        return { allHoldingsWithGains, assetClassAllocation, portfolioAllocation };
    }, [data, exchangeRate]);

    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiError, setAiError] = useState<string | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

    const diversification = useMemo(() => {
        const totalValue = allHoldingsWithGains.reduce((s, h) => s + h.currentValue, 0);
        const topHolding = [...allHoldingsWithGains].sort((a, b) => b.currentValue - a.currentValue)[0];
        const topHoldingPct = totalValue > 0 && topHolding ? (topHolding.currentValue / totalValue) * 100 : 0;
        const topAssetClass = assetClassAllocation[0];
        const topAssetClassPct = totalValue > 0 && topAssetClass ? (topAssetClass.value / totalValue) * 100 : 0;

        const weights = allHoldingsWithGains
            .map(h => (totalValue > 0 ? h.currentValue / totalValue : 0))
            .filter(w => w > 0);
        const hhi = weights.reduce((acc, w) => acc + w * w, 0);
        const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;

        const warnings: string[] = [];
        if (topHoldingPct > 25) warnings.push(`Top holding concentration is high (${topHoldingPct.toFixed(1)}%).`);
        if (topAssetClassPct > 60) warnings.push(`Top asset class concentration is high (${topAssetClassPct.toFixed(1)}%).`);
        if (effectiveHoldings > 0 && effectiveHoldings < 8) warnings.push(`Effective diversification is low (${effectiveHoldings.toFixed(1)} equivalent holdings).`);

        const status: 'healthy' | 'watch' | 'alert' =
            warnings.length === 0 ? 'healthy' : warnings.length === 1 ? 'watch' : 'alert';

        return {
            totalValue: totalValue ?? 0,
            topHolding,
            topHoldingPct: Number.isFinite(topHoldingPct) ? topHoldingPct : 0,
            topAssetClass,
            topAssetClassPct: Number.isFinite(topAssetClassPct) ? topAssetClassPct : 0,
            hhi: Number.isFinite(hhi) ? hhi : 0,
            effectiveHoldings: Number.isFinite(effectiveHoldings) ? effectiveHoldings : 0,
            warnings,
            status,
        };
    }, [allHoldingsWithGains, assetClassAllocation]);

    const handleGenerateAnalysis = useCallback(async () => {
        setIsAiLoading(true);
        setAiError(null);
        try {
            const topHoldings = [...allHoldingsWithGains].sort((a, b) => b.gainLossPercent - a.gainLossPercent);
            const result = await getAIInvestmentOverviewAnalysis(portfolioAllocation, assetClassAllocation, topHoldings.map(h => ({ name: h.name || h.symbol, gainLossPercent: h.gainLossPercent })));
            setAiAnalysis(result);
        } catch (err) {
            setAiError(formatAiError(err));
            setAiAnalysis('');
        } finally {
            setIsAiLoading(false);
        }
    }, [allHoldingsWithGains, portfolioAllocation, assetClassAllocation]);

    if (loading || !data) {
        return (
            <div className="flex justify-center items-center min-h-[20rem]" aria-busy="true">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Loading investment overview" />
            </div>
        );
    }

    const hasNoPortfolios = portfolioAllocation.length === 0;

    return (
        <div className="space-y-6 mt-4">
            {hasNoPortfolios && setActiveTab && (
                <div className="section-card border-primary/30 bg-primary/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <p className="text-slate-700">You don&apos;t have any portfolios yet. Add platforms and portfolios to see your investment overview and allocation.</p>
                    <button type="button" onClick={() => setActiveTab('Portfolios')} className="btn-primary whitespace-nowrap">Go to Portfolios</button>
                </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolios</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{portfolioAllocation.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracked Shares</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{allHoldingsWithGains.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Engine Status</p>
                    <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isAiAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {isAiAvailable ? <CheckCircleIcon className="h-4 w-4" /> : <ExclamationTriangleIcon className="h-4 w-4" />} {isAiAvailable ? 'Operational' : 'Offline'}
                    </p>
                </div>
            </div>

            <div className={`rounded-xl border p-4 ${
                diversification.status === 'healthy'
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : diversification.status === 'watch'
                    ? 'border-amber-200 bg-amber-50/70'
                    : 'border-rose-200 bg-rose-50/70'
            }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">Diversification monitor</p>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        diversification.status === 'healthy'
                            ? 'bg-emerald-100 text-emerald-700'
                            : diversification.status === 'watch'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                    }`}>{diversification.status === 'healthy' ? 'Healthy' : diversification.status === 'watch' ? 'Watch' : 'Alert'}</span>
                </div>
                {diversification.warnings.length > 0 ? (
                    <ul className="mt-2 text-sm space-y-1 text-slate-700">
                        {diversification.warnings.map((warning, idx) => (
                            <li key={idx} className="flex items-start gap-2"><ExclamationTriangleIcon className="h-4 w-4 mt-0.5 text-amber-600" />{warning}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-2 text-sm text-emerald-700">Allocation concentration is within recommended guardrails.</p>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top holding</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">{diversification.topHolding?.symbol || '—'}</p>
                    <p className="text-sm tabular-nums text-slate-600">{diversification.topHoldingPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top asset class</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">{diversification.topAssetClass?.name || '—'}</p>
                    <p className="text-sm tabular-nums text-slate-600">{diversification.topAssetClassPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">HHI</p>
                    <p className="text-lg font-bold text-slate-900 mt-1 tabular-nums">{diversification.hhi.toFixed(3)}</p>
                    <p className="text-xs text-slate-500">Lower is better diversification</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Effective holdings</p>
                    <p className="text-lg font-bold text-slate-900 mt-1 tabular-nums">{diversification.effectiveHoldings.toFixed(1)}</p>
                    <p className="text-xs text-slate-500">Equivalent equal-weight positions</p>
                </div>
            </div>

            <div className="section-card">
                <h3 className="section-title mb-1">Concentration diagram</h3>
                <p className="text-sm text-slate-500 mb-4">Visual concentration bars for top holdings and asset classes.</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top holdings exposure</p>
                        {allHoldingsWithGains
                            .slice()
                            .sort((a, b) => b.currentValue - a.currentValue)
                            .slice(0, 5)
                            .map((h) => {
                                const pct = diversification.totalValue > 0 ? (h.currentValue / diversification.totalValue) * 100 : 0;
                                return (
                                    <div key={h.id}>
                                        <div className="flex items-center justify-between text-xs text-slate-600"><span>{h.symbol}</span><span className="tabular-nums">{pct.toFixed(1)}%</span></div>
                                        <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${pct > 20 ? 'bg-rose-500' : pct > 12 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                                    </div>
                                );
                            })}
                    </div>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Asset class exposure</p>
                        {assetClassAllocation.slice(0, 5).map((a) => {
                            const pct = diversification.totalValue > 0 ? (a.value / diversification.totalValue) * 100 : 0;
                            return (
                                <div key={a.name}>
                                    <div className="flex items-center justify-between text-xs text-slate-600"><span>{a.name}</span><span className="tabular-nums">{pct.toFixed(1)}%</span></div>
                                    <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${pct > 45 ? 'bg-rose-500' : pct > 30 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="section-card">
                <div className="flex justify-between items-center mb-4">
                    <div><h3 className="section-title !mb-1">SWOT Analysis</h3><p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p></div>
                    <button onClick={handleGenerateAnalysis} disabled={isAiLoading} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed" title={'Generate SWOT Analysis'}>
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isAiLoading ? 'Analyzing...' : 'Generate SWOT Analysis'}
                    </button>
                </div>
                {!isAiAvailable && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">AI provider is currently unavailable. SWOT will still run using deterministic fallback guidance.</div>}
                {aiError && <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><SafeMarkdownRenderer content={aiError} /><button type="button" onClick={handleGenerateAnalysis} className="mt-2 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200">Retry</button></div>}
                {isAiLoading && <p className="text-sm text-center text-slate-500 py-4">Performing strategic analysis on your portfolio...</p>}
                {!isAiLoading && aiAnalysis && <SafeMarkdownRenderer content={aiAnalysis} />}
                {!isAiLoading && !aiAnalysis && !aiError && <p className="text-sm text-center text-slate-500 py-4">Click "Generate SWOT Analysis" for an expert strategic overview of your investments.</p>}
            </div>
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                <div className="section-card flex flex-col min-h-[460px] border border-slate-200 shadow-sm">
                    <h3 className="section-title mb-1">Portfolio Allocation</h3>
                    <p className="text-sm text-slate-500 mb-4">How your total investment value is distributed across portfolios.</p>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden flex items-center justify-center">
                        {portfolioAllocation?.length ? (
                            <div className="w-full h-full">
                                <AllocationPieChart data={portfolioAllocation} />
                            </div>
                        ) : (
                            <div className="empty-state flex flex-col items-center justify-center h-full w-full gap-3 text-slate-600">
                                <span>No portfolio allocation data.</span>
                                {setActiveTab && (
                                    <button type="button" onClick={() => setActiveTab('Portfolios')} className="btn-primary text-sm py-2 px-4 rounded-lg">Go to Portfolios</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="section-card flex flex-col min-h-[460px] border border-slate-200 shadow-sm">
                    <h3 className="section-title mb-1">Allocation by Asset Class</h3>
                    <p className="text-sm text-slate-500 mb-4">The mix of asset types across all your investments.</p>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden">
                        <AllocationBarChart data={assetClassAllocation} />
                    </div>
                </div>
            </div>
            <div className="section-card flex flex-col min-h-[460px] border border-slate-200 shadow-sm">
                <h3 className="section-title mb-1">Consolidated Holdings Performance</h3>
                <p className="text-sm text-slate-500 mb-4">Size represents market value; color represents performance (unrealized gain/loss %).</p>
                <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden">
                    {allHoldingsWithGains.length > 0 ? (
                        <PerformanceTreemap data={allHoldingsWithGains} />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm empty-state gap-3">
                            <span>No holdings to display in the treemap.</span>
                            {setActiveTab && (
                                <button type="button" onClick={() => setActiveTab('Portfolios')} className="btn-primary text-sm py-2 px-4 rounded-lg">Go to Portfolios</button>
                            )}
                        </div>
                    )}
                </div>
                <p className="mt-3 text-xs text-slate-500">If chart tiles are still loading after switching tabs, wait a moment—the layout now auto-recalculates on resize/show.</p>
            </div>
        </div>
    );
};

export default InvestmentOverview;
