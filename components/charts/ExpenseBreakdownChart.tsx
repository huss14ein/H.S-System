
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface ChartData {
    name: string;
    value: number;
}

interface ExpenseBreakdownChartProps {
    data: ChartData[];
}

const ExpenseBreakdownChart: React.FC<ExpenseBreakdownChartProps> = ({ data }) => {
    const { formatCurrencyString } = useFormatCurrency();

    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-full text-gray-500">No expense data for this period.</div>;
    }
    
    const chartData = data.slice(0, 7).reverse(); // Show top 7 categories

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                layout="vertical"
                data={chartData}
                margin={{
                    top: 5,
                    right: 30,
                    left: 20,
                    bottom: 5,
                }}
            >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    width={120} 
                    tick={{ fontSize: 12, fill: '#4b5563' }}
                />
                <Tooltip
                    cursor={{ fill: 'rgba(239, 246, 255, 0.5)' }}
                    formatter={(value: number) => [formatCurrencyString(value), "Spent"]}
                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(2px)', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="value" name="Amount Spent" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                     <LabelList 
                        dataKey="value" 
                        position="right" 
                        formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
                        style={{ fontSize: '12px', fill: '#1f2937', fontWeight: '500' }}
                    />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};

export default ExpenseBreakdownChart;
