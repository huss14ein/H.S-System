import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { DataContext } from '../context/DataContext';
import { collectTrackedSymbols, getStaleQuoteSymbols } from '../services/dataQuality';
import { getExchangeMarketStatus } from '../services/finnhubService';
import { quoteSourceDisplayLabel, isQuotesFromLiveApi } from '../services/quoteSessionStatus';
import type { QuotesPriceSource } from '../context/MarketDataContext';

function formatRelativeTime(date: Date | null): string {
  if (!date) return '—';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sourceTone(source: QuotesPriceSource): { text: string; dot: string; pill: string } {
  if (source === 'live') {
    return { text: 'text-green-700', dot: 'bg-green-500', pill: 'bg-green-100 text-green-700' };
  }
  if (source === 'cached') {
    return { text: 'text-sky-700', dot: 'bg-sky-500', pill: 'bg-sky-100 text-sky-700' };
  }
  return { text: 'text-amber-700', dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-700' };
}

interface LivePricesStatusProps {
  /** Inline (single line) or badge-only */
  variant?: 'inline' | 'badge';
  className?: string;
}

/**
 * Shows whether prices are live, cached, or simulated and when they were last updated.
 * Uses `quotesPriceSource` — same signal as the header refresh badge.
 */
const LivePricesStatus: React.FC<LivePricesStatusProps> = ({ variant = 'inline', className = '' }) => {
  const { quotesPriceSource, lastUpdated, isRefreshing, quotesRefreshUIScope, symbolQuoteUpdatedAt } =
    useMarketQuoteMeta();
  const inlineRefreshing = isRefreshing && quotesRefreshUIScope.mode === 'all';
  const label = quoteSourceDisplayLabel(quotesPriceSource);
  const tone = sourceTone(quotesPriceSource);
  const dataCtx = useContext(DataContext);
  const staleSymbols = useMemo(() => {
    const d = dataCtx?.data;
    if (!d || Object.keys(symbolQuoteUpdatedAt).length === 0) return [] as string[];
    const syms = collectTrackedSymbols(d as Parameters<typeof collectTrackedSymbols>[0]);
    return getStaleQuoteSymbols(syms, symbolQuoteUpdatedAt, isQuotesFromLiveApi(quotesPriceSource));
  }, [dataCtx?.data, symbolQuoteUpdatedAt, quotesPriceSource]);
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(lastUpdated));
  const [usSession, setUsSession] = useState<string | null>(null);

  useEffect(() => {
    setRelativeTime(formatRelativeTime(lastUpdated));
    const t = setInterval(() => setRelativeTime(formatRelativeTime(lastUpdated)), 10000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  useEffect(() => {
    if (!isQuotesFromLiveApi(quotesPriceSource) || !import.meta.env.VITE_FINNHUB_API_KEY) {
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
  }, [quotesPriceSource]);

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${tone.pill} ${className}`}
        title={
          [
            staleSymbols.length > 0
              ? `${staleSymbols.length} symbol(s) may need refresh: ${staleSymbols.slice(0, 5).join(', ')}`
              : null,
            `${label} prices • Updated ${relativeTime}`,
            usSession || null,
          ]
            .filter(Boolean)
            .join(' · ')
        }
      >
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        {label}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`}>
      <span className={`inline-flex items-center gap-1.5 font-medium ${tone.text}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tone.dot}`} title={`${label} prices`} />
        {label === 'Live' ? 'Live prices' : label === 'Cached' ? 'Cached prices' : 'Simulated prices'}
      </span>
      <span className="text-slate-400">·</span>
      <span className="tabular-nums whitespace-nowrap">
        {inlineRefreshing ? 'Updating…' : `Updated ${relativeTime}`}
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
