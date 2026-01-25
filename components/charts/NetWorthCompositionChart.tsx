
import React, { useState, useMemo, useContext } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DataContext } from '../../context/DataContext';

type TimePeriod = '1Y' | '3Y' | 'All';


const NetWorthCompositionChart: React.FC<{title: string}> = ({title}) => {
    const { data } = useContext(DataContext)!;
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
        const currentInvestments = data.investments.reduce((sum, p) => sum + p.holdings.reduce((hSum, h) => hSum + h.currentValue, 0), 0);
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
    }, [data, timePeriod]);

    return (
        <div className="h-full flex flex-col">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-dark">{title}</h3>
                <div className="flex space-x-1 bg-gray-100 p-1 rounded-md">
                    {(['1Y', '3Y', 'All'] as TimePeriod[]).map(period => (
                        <button
                            key={period}
                            onClick={() => setTimePeriod(period)}
                            className={`px-3 py-1 text-xs font-medium rounded ${
                                timePeriod === period ? 'bg-white shadow text-primary' : 'text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {period}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 30, left: 20, bottom: 0 }}
                        stackOffset="sign" // This is key for handling positive and negative values
                    >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} />
                        <YAxis 
                            tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
                            width={80}
                        />
                        <Tooltip 
                            formatter={(value: number, name: string) => [`SAR ${value.toLocaleString()}`, name]}
                            contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(2px)' }}
                        />
                        <Legend />
                        <defs>
                            <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                            </linearGradient>
                            <linearGradient id="colorInvestments" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                            </linearGradient>
                            <linearGradient id="colorProperty" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                            </linearGradient>
                            <linearGradient id="colorLiabilities" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                            </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="Cash" stackId="1" stroke="#3b82f6" fill="url(#colorCash)" />
                        <Area type="monotone" dataKey="Investments" stackId="1" stroke="#8b5cf6" fill="url(#colorInvestments)" />
                        <Area type="monotone" dataKey="Property" stackId="1" stroke="#10b981" fill="url(#colorProperty)" />
                        <Area type="monotone" dataKey="Liabilities" stackId="2" stroke="#ef4444" fill="url(#colorLiabilities)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default NetWorthCompositionChart;
