import React, { useMemo, useRef, useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';

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
        const point = payload[0].payload;
        const percentage = totalValue > 0 ? (point.value / totalValue) * 100 : 0;
        return (
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-sm min-w-[120px]">
                <p className="font-bold text-dark">{point.name}</p>
                <p className="text-gray-600">{formatCurrencyString(point.value)}</p>
                <p className="font-medium" style={{ color: payload[0].fill }}>{percentage.toFixed(2)}% of total</p>
            </div>
        );
    }
    return null;
};

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = chartHostRef.current;
    if (!el) return;

    const updateSize = () => {
      setChartSize({ width: el.clientWidth, height: el.clientHeight });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(el);

    return () => observer.disconnect();
  }, []);
  const sanitizedData = useMemo(
    () => (data || []).filter((d) => Number.isFinite(d.value) && d.value > 0),
    [data]
  );
  const totalValue = useMemo(() => sanitizedData.reduce((sum, entry) => sum + entry.value, 0), [sanitizedData]);
  const isEmpty = !sanitizedData.length || totalValue <= 0;
  const tooltipPosition = chartSize.width >= 640
    ? { x: Math.max(8, chartSize.width - 220), y: Math.max(10, Math.round(chartSize.height * 0.24)) }
    : undefined;
  const pieCenterX = chartSize.width >= 640 ? '38%' : '50%';

  return (
    <ChartContainer className="w-full h-full min-h-[200px] relative" isEmpty={isEmpty}>
      <div ref={chartHostRef} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={sanitizedData}
            cx={pieCenterX}
            cy="50%"
            labelLine={false}
            label={sanitizedData.length > 1 ? renderCustomizedLabel : undefined}
            outerRadius="80%"
            innerRadius="60%"
            dataKey="value"
            paddingAngle={3}
            isAnimationActive={true}
            animationDuration={800}
          >
            {sanitizedData.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
            ))}
          </Pie>
          {sanitizedData.length > 1 && (
            <Tooltip
              content={<CustomTooltip totalValue={totalValue} />}
              position={tooltipPosition}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ pointerEvents: 'none' }}
            />
          )}
          {sanitizedData.length > 1 && <Legend iconType="circle" verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />}
        </PieChart>
      </ResponsiveContainer>
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
        <div className="rounded-xl bg-white/97 border border-slate-200 shadow-sm px-4 py-2.5 text-center max-w-[82%]">
          <p className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase tracking-[0.12em]">Total Value</p>
          <p className="text-xl sm:text-2xl font-bold text-dark tabular-nums mt-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatCurrencyString(totalValue, { digits: 0 })}</p>
          {sanitizedData.length === 1 && <p className="text-xs text-slate-500 mt-0.5">{sanitizedData[0].name}</p>}
        </div>
      </div>
    </ChartContainer>
  );
};

export default AllocationPieChart;
