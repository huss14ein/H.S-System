/**
 * Restore persisted quote cache into session state and holding notionals — no network.
 * Live provider fetches run only when the user clicks Refresh prices.
 */

import type { CommodityHolding, FinancialData, InvestmentPortfolio } from '../types';
import {
  cacheRowsToSimulatedMap,
  loadQuoteCacheRows,
  type CachedQuoteRow,
} from './quotePriceCache';
import { expandLiveQuotesForRequestedSymbols, type LiveQuoteRow } from './finnhubService';
import { getRefreshableHoldingQuoteSymbols } from './quoteRefreshSymbols';
import {
  buildCommodityHoldingValueUpdatesFromTrustedSnapshot,
  buildEquityHoldingValueUpdatesFromTrustedSnapshot,
  filterNoOpHoldingValueUpdates,
} from './marketSimulatorHoldingPersist';

export type CachedSymbolTimestamps = Record<string, string>;

export function symbolTimestampsFromCacheRows(rows: Record<string, CachedQuoteRow>): CachedSymbolTimestamps {
  const out: CachedSymbolTimestamps = {};
  for (const [key, row] of Object.entries(rows)) {
    if (!Number.isFinite(row.fetchedAt) || row.fetchedAt <= 0) continue;
    const iso = new Date(row.fetchedAt).toISOString();
    out[key.trim().toUpperCase()] = iso;
  }
  return out;
}

export function latestQuoteCacheTimestamp(rows: Record<string, CachedQuoteRow>): Date | null {
  let max = 0;
  for (const row of Object.values(rows)) {
    if (Number.isFinite(row.fetchedAt) && row.fetchedAt > max) max = row.fetchedAt;
  }
  return max > 0 ? new Date(max) : null;
}

export function buildTrustedSnapshotFromCacheForSymbols(
  symbols: string[],
  rows: Record<string, CachedQuoteRow> = loadQuoteCacheRows(),
): Record<string, LiveQuoteRow> {
  if (!symbols.length) return {};
  const cacheSim = cacheRowsToSimulatedMap(rows);
  return expandLiveQuotesForRequestedSymbols(symbols, cacheSim as Record<string, LiveQuoteRow>);
}

export function collectTrackedQuoteSymbols(data: FinancialData): string[] {
  const inv = (data.investments ?? []) as InvestmentPortfolio[];
  const holdings = inv.flatMap((p) => p.holdings ?? []);
  const holdingSymbols = getRefreshableHoldingQuoteSymbols(
    holdings as { symbol?: string; holdingType?: string; holding_type?: string }[],
  );
  const watch = data.watchlist ?? [];
  const planned = data.plannedTrades ?? [];
  const comm = data.commodityHoldings ?? [];
  return Array.from(
    new Set([
      ...holdingSymbols,
      ...watch.map((w) => w.symbol).filter((s): s is string => Boolean(s)),
      ...planned.map((t) => t.symbol).filter((s): s is string => Boolean(s)),
      ...comm.map((c) => c.symbol).filter((s): s is string => Boolean(s)),
    ]),
  );
}

export type RestoreCachedQuotesResult = {
  trusted: Record<string, LiveQuoteRow>;
  equityUpdates: { id: string; currentValue: number }[];
  commodityUpdates: { id: string; currentValue: number }[];
  timestamps: CachedSymbolTimestamps;
  lastUpdated: Date | null;
  hasCache: boolean;
};

/** Build local holding updates from persisted quotes only (no API). */
export function computeRestoreCachedQuotesPatch(
  data: FinancialData,
  sarPerUsd: number,
  rows: Record<string, CachedQuoteRow> = loadQuoteCacheRows(),
): RestoreCachedQuotesResult {
  const symbols = collectTrackedQuoteSymbols(data);
  const trusted = buildTrustedSnapshotFromCacheForSymbols(symbols, rows);
  const inv = (data.investments ?? []) as InvestmentPortfolio[];
  const comm = (data.commodityHoldings ?? []) as CommodityHolding[];
  const equityUpdates = filterNoOpHoldingValueUpdates(
    inv,
    buildEquityHoldingValueUpdatesFromTrustedSnapshot(inv, trusted, sarPerUsd),
  );
  const commodityUpdates = buildCommodityHoldingValueUpdatesFromTrustedSnapshot(comm, trusted);
  return {
    trusted,
    equityUpdates,
    commodityUpdates,
    timestamps: symbolTimestampsFromCacheRows(rows),
    lastUpdated: latestQuoteCacheTimestamp(rows),
    hasCache: Object.keys(rows).length > 0,
  };
}
