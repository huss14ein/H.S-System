
import React, { useState, useMemo } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ComposedChart, Bar, Cell } from 'recharts';

type TimePeriod = '1M' | '3M' | '1Y' | 'All';

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
        case '1Y':
            startDate.setFullYear(now.getFullYear() - 1);
            points = 365;
            break;
        case 'All':
            startDate.setFullYear(now.getFullYear() - 3);
            points = 3 * 365;
            break;
    }

    let currentValue = totalValue * (0.8 + Math.random() * 0.1);
    const timeDiff = now.getTime() - startDate.getTime();
    let lastValue = currentValue;

    for (let i = 0; i <= points; i++) {
        const date = new Date(startDate.getTime() + (timeDiff * i / points));
        const dailyChange = (Math.random() - 0.48) * (totalValue / 200);
        currentValue += dailyChange;
        
        data.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
            "Cumulative P&L": currentValue - data[0]?.["Cumulative P&L"] || 0,
            "Daily Change": dailyChange,
        });
    }

    return data;
};

interface CumulativePLChartProps {
    initialValue: number;
}

const CumulativePLChart: React.FC<CumulativePLChartProps> = ({ initialValue }) => {
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('1Y');

    const chartData = useMemo(() => generateMockData(timePeriod, initialValue), [timePeriod, initialValue]);
    
    const formatCurrency = (value: number) => `SAR ${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="text-base font-semibold text-dark">{`Cumulative P&L: ${formatCurrency(payload[1].value)}`}</p>
                    <p className={`text-sm font-medium ${payload[0].value >= 0 ? 'text-green-600' : 'text-red-600'}`}>{`Daily Change: ${formatCurrency(payload[0].value)}`}</p>
                </div>
            );
        }
        return null;
    };


    return (
        <div className="bg-white p-6 rounded-lg shadow h-full flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-dark">Net Worth P&L</h3>
                <div className="flex space-x-1 bg-gray-100 p-1 rounded-md">
                    {(['1M', '3M', '1Y', 'All'] as TimePeriod[]).map(period => (
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
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis dataKey="date" stroke="#6b7280" fontSize={10} interval="preserveStartEnd" tickFormatter={(label) => label.split(',')[0]}/>
                        <YAxis yAxisId="left" 
                            orientation="left"
                            tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
                            stroke="#1e40af"
                            width={50}
                        />
                         <YAxis yAxisId="right" orientation="right" hide={true} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <defs>
                            <linearGradient id="colorPL" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1e40af" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#1e40af" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <Bar yAxisId="right" dataKey="Daily Change" name="Daily Change" barSize={10}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry['Daily Change'] >= 0 ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'} />
                            ))}
                        </Bar>
                        <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="Cumulative P&L"
                            name="Cumulative P&L"
                            stroke="#1e40af"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorPL)"
                        />
                        <ReferenceLine yAxisId="left" y={0} stroke="#6b7280" strokeDasharray="4 4" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default CumulativePLChart;
