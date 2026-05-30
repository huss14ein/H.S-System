import React, { useMemo } from 'react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer } from 'recharts';

export type ExecutiveKpiStatus = 'good' | 'warn' | 'bad' | 'neutral';

const STATUS_STYLES: Record<
  ExecutiveKpiStatus,
  { border: string; bg: string; badge: string; badgeText: string }
> = {
  good: {
    border: 'border-emerald-200',
    bg: 'from-emerald-50/90 to-white',
    badge: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
  },
  warn: {
    border: 'border-amber-200',
    bg: 'from-amber-50/90 to-white',
    badge: 'bg-amber-100',
    badgeText: 'text-amber-900',
  },
  bad: {
    border: 'border-rose-200',
    bg: 'from-rose-50/90 to-white',
    badge: 'bg-rose-100',
    badgeText: 'text-rose-800',
  },
  neutral: {
    border: 'border-slate-200',
    bg: 'from-slate-50/90 to-white',
    badge: 'bg-slate-100',
    badgeText: 'text-slate-700',
  },
};

export const ExecutiveKpiCard: React.FC<{
  title: string;
  currentValue: string;
  targetValue?: string;
  targetLabel?: string;
  status: ExecutiveKpiStatus;
  statusLabel: string;
  sparkline: number[];
  sparklineTarget?: number;
  accentStroke?: string;
}> = ({
  title,
  currentValue,
  targetValue,
  targetLabel,
  status,
  statusLabel,
  sparkline,
  sparklineTarget,
  accentStroke = '#6366f1',
}) => {
  const styles = STATUS_STYLES[status];
  const chartData = useMemo(
    () => sparkline.map((v, i) => ({ i, v })),
    [sparkline],
  );

  return (
    <div
      className={`rounded-2xl border ${styles.border} bg-gradient-to-br ${styles.bg} p-4 shadow-sm hover:shadow-md transition-shadow min-w-0`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.badge} ${styles.badgeText}`}>
          {statusLabel}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums truncate">{currentValue}</p>
      {targetValue && (
        <p className="mt-1 text-xs text-slate-600">
          {targetLabel ?? 'Target'}: <span className="font-semibold tabular-nums">{targetValue}</span>
        </p>
      )}
      {chartData.length >= 2 && (
        <div className="mt-3 h-14 w-full" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              {typeof sparklineTarget === 'number' && Number.isFinite(sparklineTarget) && (
                <ReferenceLine y={sparklineTarget} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
              )}
              <Area
                type="monotone"
                dataKey="v"
                stroke={accentStroke}
                fill={accentStroke}
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default ExecutiveKpiCard;
