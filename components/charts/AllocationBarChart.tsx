import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface ChartData {
    name: string;
    value: number;
}

interface AllocationBarChartProps {
    data: ChartData[];
}

const COLORS = ['#4f46e5', '#be185d', '#f59e0b', '#10b981', '#6366f1', '#f43f5e', '#fbbf24', '#22c55e'];

const CustomTooltip: React.FC<any> = ({ active, payload, totalValue }) => {
    const { formatCurrencyString } = useFormatCurrency();
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const percentage = totalValue > 0 ? (data.value / totalValue) * 100 : 0;
        return (
            <div className="bg-white/80 backdrop-blur-sm p-3 border border-gray-200 rounded-lg shadow-lg text-sm">
                <p className="font-bold text-dark">{data.name}</p>
                <p className="text-gray-600">{formatCurrencyString(data.value)}</p>
                <p className="font-medium" style={{ color: payload[0].fill }}>{percentage.toFixed(2)}% of total</p>
            </div>
        );
    }
    return null;
};

const AllocationBarChart: React.FC<AllocationBarChartProps> = ({ data }) => {
    const { formatCurrencyString } = useFormatCurrency();

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500">No data to display.</div>;
    }

    const totalValue = data.reduce((sum, item) => sum + item.value, 0);
    const chartData = [...data].reverse();

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
            >
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
                    content={<CustomTooltip totalValue={totalValue} />}
                />
                <Bar dataKey="value" name="Value" barSize={20} radius={[0, 4, 4, 0]}>
                    {chartData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
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