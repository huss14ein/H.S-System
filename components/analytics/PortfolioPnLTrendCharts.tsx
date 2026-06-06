import React, { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '../../context/LanguageContext';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { PortfolioPnLDailyPoint } from '../../services/portfolioPeriodPnL';
import { dashboardChartMargin } from '../dashboard/chartLayout';
import { DashboardVisualCard } from '../dashboard/DashboardVisualCard';

const PnLAreaChart: React.FC<{
  title: string;
  subtitle: string;
  points: PortfolioPnLDailyPoint[];
  totalSar: number;
  accent: 'violet' | 'sky';
}> = ({ title, subtitle, points, totalSar, accent }) => {
  const { dir } = useLanguage();
  const { formatCurrencyString } = useFormatCurrency();
  const positive = totalSar >= 0;
  const stroke = positive ? '#4f46e5' : '#e11d48';
  const fill = positive ? '#c7d2fe' : '#fecdd3';

  const data = useMemo(
    () =>
      points.map((p) => ({
        label: p.label,
        cumulative: p.cumulativeSar,
        daily: p.totalSar,
      })),
    [points],
  );

  if (data.length === 0) return null;

  return (
    <DashboardVisualCard
      dir={dir}
      accent={accent}
      title={title}
      subtitle={subtitle}
      action={
        <span className={`text-sm font-bold tabular-nums ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
          {totalSar >= 0 ? '+' : ''}
          {formatCurrencyString(totalSar, { digits: 0 })}
        </span>
      }
    >
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={dashboardChartMargin(dir)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickFormatter={(v) =>
                Math.abs(Number(v)) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${Math.round(Number(v))}`
              }
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as { cumulative?: number; daily?: number } | undefined;
                return (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                    <p className="font-semibold text-slate-800">{label}</p>
                    <p className="mt-1 tabular-nums text-slate-700">
                      Day: <span className="font-semibold">{formatCurrencyString(row?.daily ?? 0, { digits: 0 })}</span>
                    </p>
                    <p className="mt-0.5 tabular-nums text-slate-700">
                      Cumulative:{' '}
                      <span className="font-semibold">{formatCurrencyString(row?.cumulative ?? 0, { digits: 0 })}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="cumulative" stroke={stroke} fill={fill} fillOpacity={0.45} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardVisualCard>
  );
};

export const PortfolioPnLTrendCharts: React.FC<{
  weekly: PortfolioPnLDailyPoint[];
  monthly: PortfolioPnLDailyPoint[];
  weeklyTotalSar: number;
  monthlyTotalSar: number;
}> = ({ weekly, monthly, weeklyTotalSar, monthlyTotalSar }) => {
  const { t } = useLanguage();

  if (weekly.length === 0 && monthly.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {weekly.length > 0 && (
        <PnLAreaChart
          title={t('weekPnLTrendTitle')}
          subtitle={t('weekPnLTrendSubtitle')}
          points={weekly}
          totalSar={weeklyTotalSar}
          accent="violet"
        />
      )}
      {monthly.length > 0 && (
        <PnLAreaChart
          title={t('monthPnLTrendTitle')}
          subtitle={t('monthPnLTrendSubtitle')}
          points={monthly}
          totalSar={monthlyTotalSar}
          accent="sky"
        />
      )}
    </div>
  );
};

export default PortfolioPnLTrendCharts;
