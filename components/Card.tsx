import React, { useState, useEffect, useRef } from 'react';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
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

const Card: React.FC<CardProps> = ({ title, value, trend, tooltip, onClick, ariaLabel, valueColor, indicatorColor, icon, density = 'compact' }) => {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValueRef = useRef<number | undefined>(undefined);

  const isPositive = trend?.includes('+') || (trend && /(surplus|under|healthy)/i.test(trend));
  const isNegative = trend?.includes('-') || (trend && /(deficit|over|critical|low)/i.test(trend));
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
    const isNumeric = typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(String(value).replace(/[^0-9.,$SAR]+/g, ""))));
    if (!isNumeric) return;
    
    const numericValue = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));

    if (prevValueRef.current !== undefined && Math.abs(numericValue - prevValueRef.current) > 0.001) {
      setFlash(numericValue > prevValueRef.current ? 'up' : 'down');
      const timer = setTimeout(() => setFlash(null), 1000);
      return () => clearTimeout(timer);
    }
    
    prevValueRef.current = numericValue;
  }, [value]);
  
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
      className={`${cardToneClass} ${compact ? 'p-4 min-h-[120px]' : 'p-5 min-h-[140px]'} rounded-xl shadow-md hover:shadow-lg transition-all duration-300 ease-in-out flex flex-col h-full border border-t-4 ${indicatorClass} ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2' : ''} ${flashClass}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {/* Header: title + icon/tooltip — same layout for all cards */}
      <div className="flex items-center justify-between gap-2 min-h-[28px] flex-shrink-0 min-w-0">
        <h3 className={`metric-label flex-1 min-w-0 ${compact ? 'text-xs' : 'text-sm'} font-medium text-slate-500 uppercase tracking-wide`}>{title}</h3>
        <div className="flex-shrink-0 flex items-center gap-0.5">
          {icon}
          {tooltip && (
            <div className="relative group">
              <InformationCircleIcon className="h-4 w-4 text-slate-400" />
              <div className="absolute bottom-full mb-2 w-48 bg-slate-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2 z-10">
                {tooltip}
                <svg className="absolute text-slate-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255"><polygon className="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Value + trend: allow full visibility without clipping. */}
      <div className="mt-2 flex-1 min-h-0 flex flex-col justify-center min-w-0">
        <p className={`metric-value ${compact ? 'text-2xl' : 'text-3xl'} font-extrabold tabular-nums ${valueToneClass}`}>{value}</p>
        {trend && (
          <div className={`metric-value flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'} mt-1 font-medium ${trendColor}`}>
            {isPositive && <ArrowTrendingUpIcon className="h-3.5 w-3.5 flex-shrink-0"/>}
            {isNegative && <ArrowTrendingDownIcon className="h-3.5 w-3.5 flex-shrink-0"/>}
            <span className="break-words">{trend}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Card;
