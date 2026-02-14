import React, { useMemo, useContext, useState, useCallback } from 'react';
import { DataContext } from '../context/DataContext';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { Holding } from '../types';
import AllocationBarChart from '../components/charts/AllocationBarChart';
import { getAIInvestmentOverviewAnalysis } from '../services/geminiService';
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
            const portfolioValue = p.holdings.reduce((sum, h) => sum + h.currentValue, 0);
            return { name: p.name, value: portfolioValue };
        }).sort((a,b) => b.value - a.value);


        return { allHoldingsWithGains, assetClassAllocation, portfolioAllocation };
    }, [data]);

    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);

    const handleGenerateAnalysis = useCallback(async () => {
        setIsAiLoading(true);
        const topHoldings = [...allHoldingsWithGains].sort((a, b) => b.gainLossPercent - a.gainLossPercent);
        // FIX: Map holdings to the type expected by the AI service, providing a fallback for the optional 'name' property.
        const result = await getAIInvestmentOverviewAnalysis(portfolioAllocation, assetClassAllocation, topHoldings.map(h => ({ name: h.name || h.symbol, gainLossPercent: h.gainLossPercent })));
        setAiAnalysis(result);
        setIsAiLoading(false);
    }, [allHoldingsWithGains, portfolioAllocation, assetClassAllocation]);

    return (
        <div className="space-y-6 mt-4">
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-dark">AI Portfolio Snapshot</h3>
                    <button onClick={handleGenerateAnalysis} disabled={isAiLoading} className="flex items-center px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400">
                        <SparklesIcon className="h-4 w-4 mr-2" />
                        {isAiLoading ? 'Analyzing...' : 'Generate Analysis'}
                    </button>
                </div>
                {isAiLoading && <p className="text-sm text-center text-gray-500 py-4">Analyzing your portfolio composition...</p>}
                {!isAiLoading && aiAnalysis && <SafeMarkdownRenderer content={aiAnalysis} />}
                {!isAiLoading && !aiAnalysis && <p className="text-sm text-center text-gray-500 py-4">Click "Generate Analysis" for an AI-powered summary of your investment overview.</p>}
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow h-[450px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Portfolio Allocation</h3>
                     <p className="text-sm text-gray-500 -mt-4 mb-4">How your total investment value is distributed across portfolios.</p>
                    <AllocationPieChart data={portfolioAllocation} />
                </div>
                <div className="bg-white p-6 rounded-lg shadow h-[450px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Allocation by Asset Class</h3>
                    <p className="text-sm text-gray-500 -mt-4 mb-4">The mix of asset types across all your investments.</p>
                    <AllocationBarChart data={assetClassAllocation} />
                </div>
            </div>
             <div className="bg-white p-6 rounded-lg shadow h-[450px]">
                <h3 className="text-lg font-semibold text-dark mb-4">Consolidated Holdings Performance</h3>
                <p className="text-sm text-gray-500 -mt-4 mb-4">Size represents market value; color represents performance (unrealized gain/loss %).</p>
                <PerformanceTreemap data={allHoldingsWithGains} />
            </div>
        </div>
    );
};

export default InvestmentOverview;
