import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_COLORS } from './chartTheme';

interface AllocationPieChartProps {
  data: { name: string; value: number }[];
}

const COLORS = CHART_COLORS.categorical;

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
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-sm min-w-[120px]">
                <p className="font-bold text-dark">{data.name}</p>
                <p className="text-gray-600">{formatCurrencyString(data.value)}</p>
                <p className="font-medium" style={{ color: payload[0].fill }}>{percentage.toFixed(2)}% of total</p>
            </div>
        );
    }
    return null;
};


const formatCompactAmount = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
};

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const totalValue = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);
  const totalDisplay = useMemo(() => formatCompactAmount(totalValue), [totalValue]);
  const totalFull = useMemo(() => formatCurrencyString(totalValue, { digits: 0 }), [formatCurrencyString, totalValue]);
  
  return (
    <div className="w-full h-full min-h-[200px] relative">
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
          <Legend iconType="circle" verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
        <p className="text-sm font-medium text-gray-500 uppercase tracking-wide text-center">Total Value</p>
        <p
          className="text-2xl sm:text-3xl font-bold text-dark tabular-nums mt-0.5 text-center whitespace-nowrap"
          title={totalFull}
        >
          {totalDisplay}
        </p>
      </div>
    </div>
  );
};

export default AllocationPieChart;