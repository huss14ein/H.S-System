import React, { useMemo, useContext, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { Holding } from '../types';
import AllocationBarChart from '../components/charts/AllocationBarChart';
import { getAIInvestmentOverviewAnalysis, formatAiError } from '../services/geminiService';
import { SparklesIcon } from '../components/icons/SparklesIcon';
import SafeMarkdownRenderer from '../components/SafeMarkdownRenderer';

const InvestmentOverview: React.FC = () => {
    const { data } = useContext(DataContext)!;

    const { allHoldingsWithGains, assetClassAllocation, portfolioAllocation } = useMemo(() => {
        const allHoldings: Holding[] = data.investments.flatMap(p => p.holdings || []);
        
        // Data for Performance Treemap
        const allHoldingsWithGains = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });

        // Data for Asset Class Allocation Bar Chart
        const assetAllocationMap = new Map<string, number>();
        allHoldings.forEach(h => {
            const assetClass = h.assetClass || 'Other';
            assetAllocationMap.set(assetClass, (assetAllocationMap.get(assetClass) || 0) + h.currentValue);
        });
        const assetClassAllocation = Array.from(assetAllocationMap, ([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
        
        // Data for Portfolio Allocation Pie Chart
        const portfolioAllocation = data.investments.map(p => {
            const portfolioValue = (p.holdings || []).reduce((sum, h) => sum + h.currentValue, 0);
            return { name: p.name, value: portfolioValue };
        }).sort((a,b) => b.value - a.value);


        return { allHoldingsWithGains, assetClassAllocation, portfolioAllocation };
    }, [data]);

    const [aiAnalysis, setAiAnalysis] = useState('');
    const [aiError, setAiError] = useState<string | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

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

    return (
        <div className="space-y-6 mt-4">
            <div className="section-card">
                <div className="flex justify-between items-center mb-4">
                    <div><h3 className="section-title !mb-1">SWOT Analysis</h3><p className="text-xs text-slate-500 mt-0.5">From your expert investment advisor</p></div>
                    <button onClick={handleGenerateAnalysis} disabled={isAiLoading} className="btn-primary">
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isAiLoading ? 'Analyzing...' : 'Generate SWOT Analysis'}
                    </button>
                </div>
                {aiError && <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><SafeMarkdownRenderer content={aiError} /><button type="button" onClick={handleGenerateAnalysis} className="mt-2 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200">Retry</button></div>}
                {isAiLoading && <p className="text-sm text-center text-slate-500 py-4">Performing strategic analysis on your portfolio...</p>}
                {!isAiLoading && aiAnalysis && <SafeMarkdownRenderer content={aiAnalysis} />}
                {!isAiLoading && !aiAnalysis && !aiError && <p className="text-sm text-center text-slate-500 py-4">Click "Generate SWOT Analysis" for an expert strategic overview of your investments.</p>}
            </div>
            
            <div className="cards-grid grid grid-cols-1 lg:grid-cols-2">
                <div className="section-card flex flex-col min-h-[420px]">
                    <h3 className="section-title mb-1">Portfolio Allocation</h3>
                    <p className="text-sm text-slate-500 mb-4">How your total investment value is distributed across portfolios.</p>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden flex items-center justify-center">
                        {portfolioAllocation?.length ? (
                            <div className="w-full h-full">
                                <AllocationPieChart data={portfolioAllocation} />
                            </div>
                        ) : (
                            <div className="empty-state flex items-center justify-center h-full w-full">No portfolio allocation data.</div>
                        )}
                    </div>
                </div>
                <div className="section-card flex flex-col min-h-[420px]">
                    <h3 className="section-title mb-1">Allocation by Asset Class</h3>
                    <p className="text-sm text-slate-500 mb-4">The mix of asset types across all your investments.</p>
                    <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden">
                        <AllocationBarChart data={assetClassAllocation} />
                    </div>
                </div>
            </div>
            <div className="section-card flex flex-col min-h-[420px]">
                <h3 className="section-title mb-1">Consolidated Holdings Performance</h3>
                <p className="text-sm text-slate-500 mb-4">Size represents market value; color represents performance (unrealized gain/loss %).</p>
                <div className="flex-1 min-h-[320px] rounded-lg overflow-hidden">
                    {allHoldingsWithGains.length > 0 ? (
                        <PerformanceTreemap data={allHoldingsWithGains} />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-500 text-sm empty-state">
                            No holdings to display in the treemap.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InvestmentOverview;