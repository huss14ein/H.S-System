import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface AllocationPieChartProps {
  data: { name: string; value: number }[];
}

const COLORS = ['#4f46e5', '#be185d', '#f59e0b', '#10b981', '#6366f1', '#f43f5e', '#fbbf24', '#22c55e'];

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent * 100 < 8) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontWeight="bold" fontSize="12px">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

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


const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const totalValue = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);
  
  return (
     <div className="w-full h-full relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomizedLabel}
            outerRadius="85%"
            innerRadius="60%"
            dataKey="value"
            paddingAngle={3}
            isAnimationActive={true}
            animationDuration={800}
          >
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip totalValue={totalValue} />} />
          <Legend iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <p className="text-sm text-gray-500">Total Value</p>
          <p className="text-3xl font-bold text-dark">{formatCurrencyString(totalValue, { digits: 0 })}</p>
      </div>
    </div>
  );
};

export default AllocationPieChart;