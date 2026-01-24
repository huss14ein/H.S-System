
import React, { useState, useMemo } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ComposedChart } from 'recharts';

type TimePeriod = '1M' | '3M' | 'YTD' | '1Y';

// Mock data generation
const generateMockData = (period: TimePeriod, totalValue: number) => {
    const data = [];
    const now = new Date();
    let startDate = new Date();
    let points = 30;

    switch (period) {
        case '1M':
            startDate.setMonth(now.getMonth() - 1);
            points = 30;
            break;
        case '3M':
            startDate.setMonth(now.getMonth() - 3);
            points = 90;
            break;
        case 'YTD':
            startDate = new Date(now.getFullYear(), 0, 1);
            points = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 3600 * 24));
            break;
        case '1Y':
            startDate.setFullYear(now.getFullYear() - 1);
            points = 365;
            break;
    }

    let currentValue = totalValue * (0.9 + Math.random() * 0.1);
    let currentGainLoss = (Math.random() - 0.5) * totalValue * 0.05;
    const timeDiff = now.getTime() - startDate.getTime();

    for (let i = 0; i <= points; i++) {
        const date = new Date(startDate.getTime() + (timeDiff * i / points));
        currentValue += (Math.random() - 0.49) * (totalValue / 100);
        currentGainLoss += (Math.random() - 0.5) * (totalValue / 200);
        data.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            value: currentValue,
            gainLoss: currentGainLoss,
        });
    }

    return data;
};

interface PortfolioPerformanceChartProps {
    initialValue: number;
}

const PortfolioPerformanceChart: React.FC<PortfolioPerformanceChartProps> = ({ initialValue }) => {
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('1M');

    const chartData = useMemo(() => generateMockData(timePeriod, initialValue), [timePeriod, initialValue]);
    
    const formatCurrency = (value: number) => `SAR ${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="text-base font-semibold text-dark">{`Value: ${formatCurrency(payload[0].value)}`}</p>
                    <p className={`text-sm font-medium ${payload[1].value >= 0 ? 'text-green-600' : 'text-red-600'}`}>{`Gain/Loss: ${formatCurrency(payload[1].value)}`}</p>
                </div>
            );
        }
        return null;
    };


    return (
        <div className="bg-white p-6 rounded-lg shadow h-96 flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-dark">Portfolio Performance</h3>
                <div className="flex space-x-1 bg-gray-100 p-1 rounded-md">
                    {(['1M', '3M', 'YTD', '1Y'] as TimePeriod[]).map(period => (
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
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tick={{ dy: 5 }} />
                        <YAxis yAxisId="left" 
                            orientation="left"
                            tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
                            stroke="#1e40af"
                            width={50}
                        />
                        <YAxis yAxisId="right"
                            orientation="right"
                            tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
                            stroke="#16a34a"
                            width={50}
                         />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="value"
                            name="Portfolio Value"
                            stroke="#1e40af"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                        />
                        <ReferenceLine yAxisId="right" y={0} stroke="#6b7280" strokeDasharray="4 4" />
                        <Area
                            yAxisId="right"
                            type="monotone"
                            dataKey="gainLoss"
                            name="Gain/Loss"
                            strokeWidth={2}
                            stroke="#16a34a"
                            fill="transparent"
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default PortfolioPerformanceChart;
