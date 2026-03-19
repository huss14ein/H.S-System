import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useMarketData } from '../context/MarketDataContext';
import { DataContext } from '../context/DataContext';
import { collectTrackedSymbols, getStaleQuoteSymbols } from '../services/dataQuality';
import { getExchangeMarketStatus } from '../services/finnhubService';

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
  const { isLive, lastUpdated, isRefreshing, symbolQuoteUpdatedAt } = useMarketData();
  const dataCtx = useContext(DataContext);
  const staleSymbols = useMemo(() => {
    const d = dataCtx?.data;
    if (!d || Object.keys(symbolQuoteUpdatedAt).length === 0) return [] as string[];
    const syms = collectTrackedSymbols(d as Parameters<typeof collectTrackedSymbols>[0]);
    return getStaleQuoteSymbols(syms, symbolQuoteUpdatedAt, isLive);
  }, [dataCtx?.data, symbolQuoteUpdatedAt, isLive]);
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(lastUpdated));
  const [usSession, setUsSession] = useState<string | null>(null);

  useEffect(() => {
    setRelativeTime(formatRelativeTime(lastUpdated));
    const t = setInterval(() => setRelativeTime(formatRelativeTime(lastUpdated)), 10000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  useEffect(() => {
    if (!isLive || !import.meta.env.VITE_FINNHUB_API_KEY) {
      setUsSession(null);
      return;
    }
    let cancelled = false;
    getExchangeMarketStatus('US')
      .then((s) => {
        if (cancelled || !s) return;
        if (s.holiday) setUsSession('US market holiday');
        else if (s.session === 'closed') setUsSession('US session: closed');
        else if (s.session === 'regular') setUsSession('US session: regular');
        else if (s.session === 'pre-market') setUsSession('US session: pre-market');
        else if (s.session === 'post-market') setUsSession('US session: after-hours');
        else if (s.session && s.session !== 'unknown') setUsSession(`US: ${s.session}`);
        else setUsSession(null);
      })
      .catch(() => {
        if (!cancelled) setUsSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isLive]);

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${isLive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} ${className}`}
        title={
          [
            staleSymbols.length > 0
              ? `${staleSymbols.length} symbol(s) may need refresh: ${staleSymbols.slice(0, 5).join(', ')}`
              : null,
            isLive ? `Live prices • Updated ${relativeTime}` : 'Simulated prices (click Refresh in header for live)',
            usSession || null,
          ]
            .filter(Boolean)
            .join(' · ')
        }
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500' : 'bg-amber-500'}`} />
        {isLive ? 'Live' : 'Simulated'}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`}>
      <span className={`inline-flex items-center gap-1.5 font-medium ${isLive ? 'text-green-700' : 'text-amber-700'}`}>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-green-500' : 'bg-amber-500'}`}
          title={isLive ? 'Live market prices' : 'Simulated prices'}
        />
        {isLive ? 'Live prices' : 'Simulated prices'}
      </span>
      <span className="text-slate-400">·</span>
      <span className="tabular-nums whitespace-nowrap">
        {isRefreshing ? 'Updating…' : `Updated ${relativeTime}`}
      </span>
      {staleSymbols.length > 0 && (
        <>
          <span className="text-slate-400">·</span>
          <span className="text-amber-700 font-medium" title={staleSymbols.join(', ')}>
            {staleSymbols.length} stale quote{staleSymbols.length === 1 ? '' : 's'}
          </span>
        </>
      )}
      {usSession && (
        <>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600 max-w-[200px] truncate" title={usSession}>
            {usSession}
          </span>
        </>
      )}
    </div>
  );
};

export default React.memo(LivePricesStatus);
