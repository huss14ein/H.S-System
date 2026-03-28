import React, { useMemo, useRef, useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Label } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';

interface AllocationPieChartProps {
  data: { name: string; value: number }[];
  showLegend?: boolean;
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

const formatCompactAmount = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
};

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data, showLegend = true }) => {
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
  const totalDisplay = useMemo(() => formatCompactAmount(totalValue), [totalValue]);
  const isEmpty = !sanitizedData.length || totalValue <= 0;
  const tooltipPosition = chartSize.width >= 640
    ? { x: Math.max(8, chartSize.width - 220), y: Math.max(10, Math.round(chartSize.height * 0.24)) }
    : undefined;
  /** Keep the donut centered so the overlay label lines up with the hole (was 38% on wide screens, which skewed the total). */
  const pieCenterX = '50%';
  const renderCenterLabel = (props: any) => {
    const { viewBox } = props ?? {};
    const cx = Number(viewBox?.cx);
    const cy = Number(viewBox?.cy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return (
      <g pointerEvents="none">
        <text x={cx} y={cy - 14} textAnchor="middle" className="fill-slate-500 text-[11px] font-semibold tracking-[0.12em] uppercase">
          TOTAL VALUE
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="fill-slate-800 text-[34px] font-bold tabular-nums" style={{ fontSize: '34px' }}>
          {totalDisplay}
        </text>
        {sanitizedData.length === 1 && (
          <text x={cx} y={cy + 40} textAnchor="middle" className="fill-slate-500 text-[11px]">
            {sanitizedData[0].name}
          </text>
        )}
      </g>
    );
  };

  return (
    <ChartContainer className="w-full h-full min-h-[200px] relative" isEmpty={isEmpty}>
      <div ref={chartHostRef} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
            <Label position="center" content={renderCenterLabel} />
            {sanitizedData.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
            ))}
          </Pie>
          {!isEmpty && (
            <Tooltip
              content={<CustomTooltip totalValue={totalValue} />}
              position={tooltipPosition}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ pointerEvents: 'none' }}
            />
          )}
          {showLegend && sanitizedData.length > 1 && <Legend iconType="circle" verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />}
        </PieChart>
      </ResponsiveContainer>
      </div>
    </ChartContainer>
  );
};

export default AllocationPieChart;
