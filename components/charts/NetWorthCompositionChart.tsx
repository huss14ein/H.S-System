
import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type TimePeriod = '1Y' | '3Y' | 'All';

// This is a simplified mock data generator for demonstration.
const generateHistoricalData = () => {
    const data = [];
    const now = new Date();
    // Start values from 5 years ago
    let cash = 150000;
    let investments = 80000;
    let property = 1800000;
    let liabilities = -1100000;

    for (let i = 60; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        
        // Simulate monthly changes
        cash += 3000 + (Math.random() - 0.4) * 2000; // Savings + volatility
        investments *= (1 + (Math.random() * 0.03 - 0.005)); // Investment growth
        property *= 1.003; // Property appreciation
        if (liabilities < -500000) { // Pay down faster in recent years
            liabilities += 4000 + (i/60 * 2000); // Pay down debt
        }
        
        const netWorth = cash + investments + property + liabilities;
        
        data.push({
            date: date.toISOString(),
            name: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
            "Net Worth": Math.round(netWorth),
            "Cash": Math.round(cash),
            "Investments": Math.round(investments),
            "Property": Math.round(property),
            "Liabilities": Math.round(liabilities)
        });
    }
    return data;
};

const fullHistoricalData = generateHistoricalData();

const NetWorthCompositionChart: React.FC<{title: string}> = ({title}) => {
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('All');

    const chartData = useMemo(() => {
        const now = new Date();
        const nowCopy1 = new Date(now);
        const nowCopy2 = new Date(now);

        switch (timePeriod) {
            case '1Y': {
                const targetDate = new Date(nowCopy1.setFullYear(nowCopy1.getFullYear() - 1));
                return fullHistoricalData.filter(d => new Date(d.date) >= targetDate);
            }
            case '3Y': {
                const targetDate = new Date(nowCopy2.setFullYear(nowCopy2.getFullYear() - 3));
                return fullHistoricalData.filter(d => new Date(d.date) >= targetDate);
            }
            case 'All':
            default:
                return fullHistoricalData;
        }
    }, [timePeriod]);

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
