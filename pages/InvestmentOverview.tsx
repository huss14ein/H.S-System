
import React, { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import Card from '../components/Card';
import PerformanceTreemap from '../components/charts/PerformanceTreemap';
import AllocationPieChart from '../components/charts/AllocationPieChart';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { Holding } from '../types';

const InvestmentOverview: React.FC = () => {
    const { data } = useContext(DataContext)!;
    const { formatCurrencyString } = useFormatCurrency();

    const { totalValue, totalGainLoss, roi, allHoldingsWithGains, assetClassAllocation } = useMemo(() => {
        const allHoldings: Holding[] = data.investments.flatMap(p => p.holdings);
        
        const totalValue = allHoldings.reduce((sum, h) => sum + h.currentValue, 0);

        // A simplified ROI calculation based on all transactions. A more accurate one would be time-weighted.
        const totalInvested = data.investmentTransactions.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.total, 0);
        const totalWithdrawn = Math.abs(data.investmentTransactions.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.total, 0));
        const netCapital = totalInvested - totalWithdrawn;
        
        const totalGainLoss = totalValue - netCapital;
        const roi = netCapital > 0 ? (totalGainLoss / netCapital) * 100 : 0;
        
        const allHoldingsWithGains = allHoldings.map(h => {
             const totalCost = h.avgCost * h.quantity;
             const gainLoss = h.currentValue - totalCost;
             const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
             return { ...h, gainLoss, gainLossPercent };
        });

        const allocation = new Map<string, number>();
        allHoldings.forEach(h => {
            const assetClass = h.assetClass || 'Other';
            allocation.set(assetClass, (allocation.get(assetClass) || 0) + h.currentValue);
        });
        const assetClassAllocation = Array.from(allocation, ([name, value]) => ({ name, value }));

        return { totalValue, totalGainLoss, roi, allHoldingsWithGains, assetClassAllocation };
    }, [data]);

    return (
        <div className="space-y-6 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Total Investment Value" value={formatCurrencyString(totalValue)} />
                <Card title="Total Unrealized Gain/Loss" value={formatCurrencyString(totalGainLoss)} />
                <Card title="Overall Portfolio ROI" value={`${roi.toFixed(2)}%`} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 bg-white p-6 rounded-lg shadow h-[450px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Consolidated Holdings Performance</h3>
                    <PerformanceTreemap data={allHoldingsWithGains} />
                </div>
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow h-[450px]">
                    <h3 className="text-lg font-semibold text-dark mb-4">Asset Class Allocation</h3>
                    <AllocationPieChart data={assetClassAllocation} />
                </div>
            </div>
        </div>
    );
};

export default InvestmentOverview;
