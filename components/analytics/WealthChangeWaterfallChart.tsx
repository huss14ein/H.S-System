import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import InteractiveChartShell from './InteractiveChartShell';

export type WaterfallStep = {
  name: string;
  deltaSar: number;
  fill: string;
};

type Props = {
  steps: WaterfallStep[];
  formatCurrency: (n: number) => string;
  className?: string;
};

/** Bridge chart: prior net worth → market → cashflow → current net worth. */
export const WealthChangeWaterfallChart: React.FC<Props> = ({ steps, formatCurrency, className = '' }) => {
  const data = steps.map((s) => ({ ...s, abs: Math.abs(s.deltaSar) }));

  return (
    <InteractiveChartShell
      title="Net worth bridge"
      subtitle="Month-over-month change drivers (SAR)"
      className={className}
      footnote="Market = investment P/L; cashflow = income minus expenses."
    >
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={36} />
            <Tooltip
              formatter={(v: number, _n, p) => [
                formatCurrency((p?.payload as WaterfallStep)?.deltaSar ?? v),
                'Change',
              ]}
            />
            <Bar dataKey="abs" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </InteractiveChartShell>
  );
};

export default WealthChangeWaterfallChart;
