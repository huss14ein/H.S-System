
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface CashflowChartProps {
    data: { name: string; income: number; expenses: number; }[];
}

const CashflowChart: React.FC<CashflowChartProps> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis dataKey="name" stroke="#6b7280" />
        <YAxis 
             tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value as number)} 
             stroke="#6b7280"
        />
        <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '0.5rem' }}
            formatter={(value) => `SAR ${Number(value).toLocaleString()}`}
        />
        <Legend />
        <Bar dataKey="income" fill="#10b981" name="Income" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" fill="#f43f5e" name="Expenses" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CashflowChart;
