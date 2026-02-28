import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { CHART_MARGIN, CHART_GRID_STROKE, CHART_GRID_COLOR, CHART_AXIS_COLOR, CHART_COLORS } from './chartTheme';
import ChartContainer from './ChartContainer';

interface ChartData {
  name: string;
  value: number;
}

interface ExpenseBreakdownChartProps {
  data: ChartData[];
}

const ExpenseBreakdownChart: React.FC<ExpenseBreakdownChartProps> = ({ data }) => {
  const { formatCurrencyString } = useFormatCurrency();
  const isEmpty = !data?.length;
  const chartData = data?.length ? data.slice(0, 7).reverse() : [];

  return (
    <ChartContainer height="100%" isEmpty={isEmpty} emptyMessage="No expense data for this period.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={chartData} margin={{ ...CHART_MARGIN, right: 36, left: 20 }}>
          <CartesianGrid strokeDasharray={CHART_GRID_STROKE} stroke={CHART_GRID_COLOR} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            axisLine={false}
            tickLine={false}
            width={120}
            tick={{ fontSize: 12, fill: CHART_AXIS_COLOR }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(241, 245, 249, 0.8)' }}
            formatter={(value: number) => [formatCurrencyString(value), 'Spent']}
            contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '10px 14px' }}
          />
          <Bar dataKey="value" name="Amount Spent" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} barSize={20}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value: number) => formatCurrencyString(value, { digits: 0 })}
              style={{ fontSize: 12, fill: '#1e293b', fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};

export default ExpenseBreakdownChart;
