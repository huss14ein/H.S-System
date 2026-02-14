import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface ChartData {
    name: string;
    value: number;
}

interface AllocationBarChartProps {
    data: ChartData[];
}

const AllocationBarChart: React.FC<AllocationBarChartProps> = ({ data }) => {
    const { formatCurrencyString } = useFormatCurrency();

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500">No data to display.</div>;
    }

    const chartData = [...data].reverse();

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 5, right: 40, left: 20, bottom: 5 }}
            >
                <defs>
                    <linearGradient id="colorBar" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#818cf8" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.8} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" hide />
                <YAxis
                    dataKey="name"
                    type="category"
                    axisLine={false}
                    tickLine={false}
                    width={100}
                    tick={{ fontSize: 12, fill: '#4b5563', fontWeight: 500 }}
                    interval={0}
                />
                <Tooltip
                    cursor={{ fill: 'rgba(239, 246, 255, 0.7)' }}
                    formatter={(value: number) => [formatCurrencyString(value), "Value"]}
                    contentStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        backdropFilter: 'blur(4px)',
                        borderRadius: '0.5rem',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                    }}
                />
                <Bar dataKey="value" name="Value" fill="url(#colorBar)" radius={[0, 4, 4, 0]} barSize={20}>
                    <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
                        style={{ fontSize: '12px', fill: '#1f2937', fontWeight: '600' }}
                    />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};

export default AllocationBarChart;