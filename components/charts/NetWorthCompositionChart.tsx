import React, { useState, useMemo, useContext } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DataContext } from '../../context/DataContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';
import { useCurrency } from '../../context/CurrencyContext';
import { getAllInvestmentsValueInSAR } from '../../utils/currencyMath';

type TimePeriod = '1Y' | '3Y' | 'All';


const NetWorthCompositionChart: React.FC<{ title: string }> = ({ title }) => {
    const { data } = useContext(DataContext)!;
    const { exchangeRate } = useCurrency();
    const { formatCurrencyString } = useFormatCurrency();
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');

    const chartData = useMemo(() => {
        const fullHistoricalData = [];
        const now = new Date();

        // 1. Calculate historical monthly net cash flow from transactions
        const monthlyNetFlows = new Map<string, number>();
        data.transactions.forEach(t => {
            const monthKey = t.date.slice(0, 7); // YYYY-MM
            const currentFlow = monthlyNetFlows.get(monthKey) || 0;
            monthlyNetFlows.set(monthKey, currentFlow + t.amount);
        });
        
        // 2. Get current asset & liability values
        const currentInvestments = getAllInvestmentsValueInSAR(data.investments, exchangeRate);
        const currentCash = data.accounts.filter(a => ['Checking', 'Savings'].includes(a.type)).reduce((sum, acc) => sum + Math.max(0, acc.balance), 0);
        const currentProperty = data.assets.filter(a => a.type === 'Property').reduce((sum, asset) => sum + asset.value, 0);
        const currentLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0) + data.accounts.filter(a => a.type === 'Credit' && a.balance < 0).reduce((sum, acc) => sum + acc.balance, 0);
        
        let cash = currentCash;
        let investments = currentInvestments;
        let property = currentProperty;
        let liabilities = currentLiabilities;

        const monthsToGoBack = 60; // 5 years

        // 3. Work backwards month by month
        for (let i = 0; i <= monthsToGoBack; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = date.toISOString().slice(0, 7);
            
            const netWorth = cash + investments + property + liabilities;
            
            fullHistoricalData.push({
                date: date.toISOString(),
                name: date.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
                "Net Worth": Math.round(netWorth),
                "Cash": Math.round(cash),
                "Investments": Math.round(investments),
                "Property": Math.round(property),
                "Liabilities": Math.round(liabilities)
            });

            // 4. "Un-apply" changes for the previous month
            // Use actual net flow for cash, making it accurate
            const netFlowThisMonth = monthlyNetFlows.get(monthKey) || 0;
            cash -= netFlowThisMonth;

            // Use simulation for investments and property
            investments /= (1 + (0.07 / 12)); // Assume 7% annual growth
            property /= 1.003; // Assume slow appreciation
            if (liabilities < -500000) { // Simple mortgage paydown simulation
                 liabilities += 4500;
            }
        }
        
        const finalData = fullHistoricalData.reverse();
        
        // 5. Filter based on selected time period
        const nowFilter = new Date();
        const nowCopy1 = new Date(nowFilter);
        const nowCopy2 = new Date(nowFilter);
        switch (timePeriod) {
            case '1Y': {
                const targetDate = new Date(nowCopy1.setFullYear(nowCopy1.getFullYear() - 1));
                return finalData.filter(d => new Date(d.date) >= targetDate);
            }
            case '3Y': {
                const targetDate = new Date(nowCopy2.setFullYear(nowCopy2.getFullYear() - 3));
                return finalData.filter(d => new Date(d.date) >= targetDate);
            }
            case 'All':
            default:
                return finalData;
        }
    }, [data, timePeriod, exchangeRate]);

    const isEmpty = !chartData?.length;

    return (
        <div className="h-full flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-dark">{title}</h3>
                <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg">
                    {(['1Y', '3Y', 'All'] as TimePeriod[]).map(period => (
                        <button
                            key={period}
                            onClick={() => setTimePeriod(period)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                timePeriod === period ? 'bg-white shadow text-primary' : 'text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {period}
                        </button>
                    ))}
                </div>
            </div>
            <ChartContainer height="100%" isEmpty={isEmpty} emptyMessage="No net worth history. Add accounts and transactions to see composition over time." className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ ...CHART_MARGIN, right: 30, left: 20 }} stackOffset="sign">
                        <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
                        <XAxis dataKey="name" fontSize={12} stroke={CHART_AXIS_COLOR} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatAxisNumber(Number(v))} width={56} stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
                        <Tooltip
                            formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
                            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
                        />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <defs>
                            <linearGradient id="chartColorCash" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorInvestments" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.secondary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorProperty" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.tertiary} stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="chartColorLiabilities" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.liability} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={CHART_COLORS.liability} stopOpacity={0.1} />
                            </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="Cash" stackId="1" stroke={CHART_COLORS.primary} fill="url(#chartColorCash)" />
                        <Area type="monotone" dataKey="Investments" stackId="1" stroke={CHART_COLORS.secondary} fill="url(#chartColorInvestments)" />
                        <Area type="monotone" dataKey="Property" stackId="1" stroke={CHART_COLORS.tertiary} fill="url(#chartColorProperty)" />
                        <Area type="monotone" dataKey="Liabilities" stackId="2" stroke={CHART_COLORS.liability} fill="url(#chartColorLiabilities)" />
                    </AreaChart>
                </ResponsiveContainer>
            </ChartContainer>
        </div>
    );
};

export default NetWorthCompositionChart;
