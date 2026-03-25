/** Max age before market quotes are considered stale (live mode). */
export const STALE_MARKET_HOURS_LIVE = 72;
/** Simulated / offline mode: warn less aggressively. */
export const STALE_MARKET_HOURS_SIM = 336; // 14d

export interface StaleMarketSummary {
  isStale: boolean;
  hoursSinceUpdate: number | null;
  message: string;
}

export function detectStaleMarketData(
  lastUpdated: Date | null,
  isLive: boolean
): StaleMarketSummary {
  if (!lastUpdated || Number.isNaN(lastUpdated.getTime())) {
    return {
      isStale: true,
      hoursSinceUpdate: null,
      message: 'Market data has never been refreshed in this session.',
    };
  }
  const ms = Date.now() - lastUpdated.getTime();
  const hours = ms / 3600000;
  const maxH = isLive ? STALE_MARKET_HOURS_LIVE : STALE_MARKET_HOURS_SIM;
  const isStale = hours > maxH;
  return {
    isStale,
    hoursSinceUpdate: hours,
    message: isStale
      ? `Last price refresh was ${hours.toFixed(0)}h ago (threshold ${maxH}h). Refresh for current quotes.`
      : 'Market data freshness OK.',
  };
}

const MS_PER_DAY = 86400000;

/** Symbols the user tracks (holdings, watchlist, planned trades, commodities). */
export function collectTrackedSymbols(data: {
  investments?: { holdings?: { symbol?: string }[] }[];
  watchlist?: { symbol?: string }[];
  plannedTrades?: { symbol?: string }[];
  commodityHoldings?: { symbol?: string }[];
}): string[] {
  const out = new Set<string>();
  const inv = (data as any)?.personalInvestments ?? data.investments ?? [];
  inv.forEach((p: { holdings?: { symbol?: string }[] }) => {
    (p.holdings ?? []).forEach((h) => {
      const s = (h.symbol ?? '').trim().toUpperCase();
      if (s) out.add(s);
    });
  });
  (data.watchlist ?? []).forEach((w) => {
    const s = (w.symbol ?? '').trim().toUpperCase();
    if (s) out.add(s);
  });
  (data.plannedTrades ?? []).forEach((t) => {
    const s = (t.symbol ?? '').trim().toUpperCase();
    if (s) out.add(s);
  });
  const comm = (data as any)?.personalCommodityHoldings ?? data.commodityHoldings ?? [];
  comm.forEach((c: { symbol?: string }) => {
    const s = (c.symbol ?? '').trim().toUpperCase();
    if (s) out.add(s);
  });
  return [...out];
}

export type GetStaleQuoteSymbolsOptions = {
  /**
   * When false, symbols with no per-symbol timestamp are not listed as stale
   * (e.g. after a fresh global refresh, some tickers may still be loading or unsupported).
   */
  countMissingTimestampAsStale?: boolean;
};

/** Per-symbol: missing timestamp or older than threshold counts as stale (unless opted out). */
export function getStaleQuoteSymbols(
  symbols: string[],
  symbolQuoteUpdatedAt: Record<string, string | undefined>,
  isLive: boolean,
  opts?: GetStaleQuoteSymbolsOptions
): string[] {
  if (symbols.length === 0) return [];
  const countMissing = opts?.countMissingTimestampAsStale !== false;
  const maxH = isLive ? STALE_MARKET_HOURS_LIVE : STALE_MARKET_HOURS_SIM;
  const msMax = maxH * 3600000;
  const stale: string[] = [];
  for (const raw of symbols) {
    const s = (raw || '').trim().toUpperCase();
    if (!s) continue;
    const iso = symbolQuoteUpdatedAt[s];
    if (!iso) {
      if (countMissing) stale.push(s);
      continue;
    }
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || Date.now() - t > msMax) stale.push(s);
  }
  return stale;
}

export function detectStaleFxRate(fxRateUpdatedAt: string | null | undefined, maxDays = 14): {
  isStale: boolean;
  daysSince: number | null;
  message: string;
} {
  if (!fxRateUpdatedAt) {
    return {
      isStale: false,
      daysSince: null,
      message: 'FX rate update time not recorded; save your investment plan to start tracking.',
    };
  }
  const t = new Date(fxRateUpdatedAt).getTime();
  if (Number.isNaN(t)) {
    return { isStale: false, daysSince: null, message: '' };
  }
  const days = (Date.now() - t) / MS_PER_DAY;
  const isStale = days > maxDays;
  return {
    isStale,
    daysSince: days,
    message: isStale
      ? `USD/SAR (plan FX) last updated ${days.toFixed(0)} days ago. Confirm rate in Investments → Monthly Plan.`
      : '',
  };
}
