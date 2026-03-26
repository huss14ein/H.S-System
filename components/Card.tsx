import React, { useState, useEffect, useRef } from 'react';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ArrowTrendingDownIcon } from './icons/ArrowTrendingDownIcon';

interface CardProps {
  title: string;
  value: React.ReactNode;
  trend?: string;
  tooltip?: string;
  onClick?: () => void;
  /** Optional aria-label when card is clickable (e.g. "Go to Summary") */
  ariaLabel?: string;
  valueColor?: string;
  indicatorColor?: 'green' | 'yellow' | 'red';
  icon?: React.ReactNode;
  density?: 'comfortable' | 'compact';
}

const isInvalidDisplayToken = (raw: string): boolean => {
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized.includes('nan') ||
    normalized.includes('infinity') ||
    normalized.includes('undefined') ||
    normalized.includes('null')
  );
};

const toFiniteNumber = (raw: React.ReactNode): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  if (isInvalidDisplayToken(raw)) return null;
  const sanitized = raw.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  if (!sanitized || sanitized === '-' || sanitized === '+' || sanitized === '.') return null;
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDisplayNode = (raw: React.ReactNode): React.ReactNode => {
  if (typeof raw === 'string') {
    if (isInvalidDisplayToken(raw)) return '—';
    return raw;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '—';
    return raw;
  }
  return raw;
};

const Card: React.FC<CardProps> = ({ title, value, trend, onClick, ariaLabel, valueColor, indicatorColor, icon, density = 'compact' }) => {
  const displayValue = normalizeDisplayNode(value);
  const displayTrend = typeof trend === 'string' && isInvalidDisplayToken(trend) ? undefined : trend;
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValueRef = useRef<number | undefined>(undefined);

  const isPositive = displayTrend?.includes('+') || (displayTrend && /(surplus|under|healthy)/i.test(displayTrend));
  const isNegative = displayTrend?.includes('-') || (displayTrend && /(deficit|over|critical|low)/i.test(displayTrend));
  let trendColor = 'text-slate-500';
  if (isPositive) trendColor = 'text-green-700';
  if (isNegative) trendColor = 'text-red-700';

  const valueToneClass = isPositive
    ? 'text-green-700'
    : isNegative
      ? 'text-red-700'
      : (valueColor || 'text-dark');

  const cardToneClass = 'bg-white border-slate-200';

  useEffect(() => {
    const numericValue = toFiniteNumber(displayValue);
    if (numericValue == null) return;

    if (prevValueRef.current !== undefined && Math.abs(numericValue - prevValueRef.current) > 0.001) {
      setFlash(numericValue > prevValueRef.current ? 'up' : 'down');
      const timer = setTimeout(() => setFlash(null), 1000);
      prevValueRef.current = numericValue;
      return () => clearTimeout(timer);
    }

    prevValueRef.current = numericValue;
  }, [displayValue]);
  
  const indicatorClass =
      indicatorColor === 'green' ? 'border-l-4 border-l-emerald-500 border-t-emerald-500/30' :
      indicatorColor === 'yellow' ? 'border-l-4 border-l-amber-500 border-t-amber-500/30' :
      indicatorColor === 'red' ? 'border-l-4 border-l-rose-500 border-t-rose-500/30' :
      'border-t-transparent';

  const flashClass = flash === 'up' ? 'flash-green' : flash === 'down' ? 'flash-red' : '';
  const compact = density === 'compact';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? (ariaLabel ?? title) : undefined}
      className={`${cardToneClass} ${compact ? 'p-4 min-h-[120px]' : 'p-5 min-h-[140px]'} rounded-xl shadow-md transition-all duration-300 ease-in-out flex flex-col h-full border border-t-4 ${indicatorClass} ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2' : ''} ${flashClass}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {/* Header: title + icon/tooltip — same layout for all cards */}
      <div className="flex items-center justify-between gap-2 min-h-[28px] flex-shrink-0 min-w-0">
        <h3 className={`metric-label flex-1 min-w-0 ${compact ? 'text-xs' : 'text-sm'} font-medium text-slate-500 uppercase tracking-wide`}>{title}</h3>
        {icon ? <div className="flex-shrink-0">{icon}</div> : null}
      </div>
      {/* Value + trend: allow full visibility without clipping. */}
      <div className="mt-2 flex-1 min-h-0 flex flex-col justify-center min-w-0 overflow-visible">
        <div
          className={`metric-value !whitespace-nowrap max-w-full ${compact ? 'text-2xl' : 'text-3xl'} font-extrabold tabular-nums ${valueToneClass}`}
        >
          {displayValue}
        </div>
        {displayTrend && (
          <div className={`metric-value flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'} mt-1 font-medium ${trendColor}`}>
            {isPositive && <ArrowTrendingUpIcon className="h-3.5 w-3.5 flex-shrink-0"/>}
            {isNegative && <ArrowTrendingDownIcon className="h-3.5 w-3.5 flex-shrink-0"/>}
            <span className="break-words">{displayTrend}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Card;
