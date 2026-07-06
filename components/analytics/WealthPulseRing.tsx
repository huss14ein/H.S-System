import React from 'react';

export type PulseSegment = {
  id: string;
  label: string;
  valueSar: number;
  color: string;
  onClick?: () => void;
};

type Props = {
  netWorthSar: number;
  segments: PulseSegment[];
  formatCurrency: (n: number) => string;
  className?: string;
};

/** Animated composition ring around net worth (Wealth Analytics hero). */
export const WealthPulseRing: React.FC<Props> = ({ netWorthSar, segments, formatCurrency, className = '' }) => {
  const total = Math.max(netWorthSar, segments.reduce((s, x) => s + Math.max(0, x.valueSar), 0), 1);
  let acc = 0;
  const stops = segments.map((seg) => {
    const pct = (Math.max(0, seg.valueSar) / total) * 100;
    const from = acc;
    acc += pct;
    return `${seg.color} ${from}% ${acc}%`;
  });

  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: 140, height: 140 }}>
      <div
        className="absolute inset-0 rounded-full motion-safe:animate-[spin_24s_linear_infinite]"
        style={{
          background: stops.length ? `conic-gradient(${stops.join(', ')})` : '#e2e8f0',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))',
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 14px), #000 calc(100% - 13px))',
        }}
        aria-hidden
      />
      <div className="relative z-10 text-center px-2">
        <p className="text-[10px] font-bold uppercase text-slate-500">Net worth</p>
        <p className="text-sm font-bold tabular-nums text-slate-900">{formatCurrency(netWorthSar)}</p>
      </div>
      <ul className="sr-only">
        {segments.map((s) => (
          <li key={s.id}>
            {s.label}: {formatCurrency(s.valueSar)}
          </li>
        ))}
      </ul>
      <div className="absolute -bottom-1 left-0 right-0 flex flex-wrap justify-center gap-1">
        {segments.slice(0, 4).map((s) => (
          <button
            key={s.id}
            type="button"
            className="text-[9px] px-1.5 py-0.5 rounded-full border border-slate-200 bg-white/90 hover:border-slate-300"
            style={{ borderLeftColor: s.color, borderLeftWidth: 3 }}
            onClick={s.onClick}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default WealthPulseRing;
