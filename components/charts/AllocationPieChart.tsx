import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface AllocationPieChartProps {
  data: { name: string; value: number }[];
}

const COLORS = ['#4f46e5', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#f43f5e', '#fbbf24'];

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = (props: any) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent * 100 < 7) return null;

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontWeight="bold" fontSize={12}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const totalValue = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);
  
  return (
     <div className="w-full h-full relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 0, right: 0, bottom: 40, left: 0 }}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomizedLabel}
            outerRadius={110}
            innerRadius={70}
            fill="#8884d8"
            dataKey="value"
            paddingAngle={2}
          >
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip formatter={(value) => formatCurrencyString(Number(value))} />
          <Legend iconType="circle" wrapperStyle={{ bottom: 0, left: 20, right: 20 }} />
        </PieChart>
      </ResponsiveContainer>
       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[calc(50%+20px)] text-center pointer-events-none">
          <p className="text-sm text-gray-500">Total Value</p>
          <p className="text-3xl font-bold text-dark">{formatCurrencyString(totalValue, { digits: 0 })}</p>
      </div>
    </div>
  );
};

export default AllocationPieChart;
