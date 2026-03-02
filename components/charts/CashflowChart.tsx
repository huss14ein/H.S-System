import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, formatAxisNumber, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';

interface CashflowChartProps {
  data: { name: string; income: number; expenses: number }[];
}

const CashflowChart: React.FC<CashflowChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const isEmpty = !data?.length;

  return (
    <ChartContainer height="100%" isEmpty={isEmpty} emptyMessage="No cash flow data for this period.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} />
          <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} />
          <YAxis
            tickFormatter={(v) => formatAxisNumber(Number(v))}
            stroke={CHART_AXIS_COLOR}
            fontSize={12}
            width={48}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px', fontSize: '13px' }}
            formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
            labelStyle={{ fontWeight: 600, color: '#1e293b' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" fill={CHART_COLORS.positive} name="Income" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" fill={CHART_COLORS.negative} name="Expenses" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};

export default CashflowChart;
