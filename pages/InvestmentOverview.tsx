import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { Holding } from '../types';
import AllocationBarChart from '../components/charts/AllocationBarChart';

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

    return (
        <div className="space-y-6 mt-4">
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