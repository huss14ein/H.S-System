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


const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const totalValue = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);
  
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
            outerRadius="84%"
            innerRadius="64%"
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
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex w-[38%] max-w-[152px] min-w-[112px] -translate-x-1/2 -translate-y-1/2 aspect-square items-center justify-center rounded-full border border-slate-200 bg-white/95 text-center px-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-[0.12em]">Total</p>
          <p className="mt-1 text-sm sm:text-base font-bold text-dark tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(totalValue, { digits: 0 })}</p>
        </div>
      </div>
    </div>
  );
};

export default AllocationPieChart;