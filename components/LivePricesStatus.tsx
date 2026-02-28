import React, { useState, useEffect } from 'react';
import { useMarketData } from '../context/MarketDataContext';

function formatRelativeTime(date: Date | null): string {
  if (!date) return '—';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface LivePricesStatusProps {
  /** Inline (single line) or badge-only */
  variant?: 'inline' | 'badge';
  className?: string;
}

/**
 * Shows whether prices are live or simulated and when they were last updated.
 * Use on Watchlist, Investments, and anywhere prices are shown.
 */
const LivePricesStatus: React.FC<LivePricesStatusProps> = ({ variant = 'inline', className = '' }) => {
  const { isLive, lastUpdated, isRefreshing } = useMarketData();
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(lastUpdated));

  useEffect(() => {
    setRelativeTime(formatRelativeTime(lastUpdated));
    const t = setInterval(() => setRelativeTime(formatRelativeTime(lastUpdated)), 10000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${isLive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} ${className}`}
        title={isLive ? `Live prices • Updated ${relativeTime}` : 'Simulated prices (click Refresh in header for live)'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500' : 'bg-amber-500'}`} />
        {isLive ? 'Live' : 'Simulated'}
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-xs text-gray-500 ${className}`}>
      <span className={`inline-flex items-center gap-1.5 font-medium ${isLive ? 'text-green-700' : 'text-amber-700'}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-green-500' : 'bg-amber-500'}`} title={isLive ? 'Live market prices' : 'Simulated prices'} />
        {isLive ? 'Live prices' : 'Simulated prices'}
      </span>
      <span className="text-gray-400">·</span>
      <span className="tabular-nums">
        {isRefreshing ? 'Updating…' : `Updated ${relativeTime}`}
      </span>
    </div>
  );
};

export default LivePricesStatus;
