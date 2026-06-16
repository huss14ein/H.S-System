import React, { useMemo } from 'react';

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

/** Lightweight SVG sparkline — avoids Recharts main-thread cost on KPI grids. */
function KpiSparklineSvg({
  values,
  stroke,
  target,
}: {
  values: number[];
  stroke: string;
  target?: number;
}) {
  const { linePoints, areaPoints, targetY } = useMemo(() => {
    const nums = values.filter((v) => Number.isFinite(v));
    if (nums.length < 2) return { linePoints: '', areaPoints: '', targetY: null as number | null };
    const all = typeof target === 'number' && Number.isFinite(target) ? [...nums, target] : nums;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const w = 100;
    const h = 56;
    const toY = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
    const pts = nums.map((v, i) => {
      const x = (i / (nums.length - 1)) * w;
      return `${x.toFixed(2)},${toY(v).toFixed(2)}`;
    });
    const line = pts.join(' ');
    const area = `0,${h} ${line} ${w},${h}`;
    const ty = typeof target === 'number' && Number.isFinite(target) ? toY(target) : null;
    return { linePoints: line, areaPoints: area, targetY: ty };
  }, [values, target]);

  if (!linePoints) return null;

  return (
    <svg viewBox="0 0 100 56" className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
      {targetY != null && (
        <line x1="0" y1={targetY} x2="100" y2={targetY} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth="1" />
      )}
      <polygon points={areaPoints} fill={stroke} fillOpacity={0.15} />
      <polyline points={linePoints} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

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
      {sparkline.length >= 2 && (
        <div className="mt-3 h-14 w-full" aria-hidden>
          <KpiSparklineSvg values={sparkline} stroke={accentStroke} target={sparklineTarget} />
        </div>
      )}
    </div>
  );
};

export default ExecutiveKpiCard;
