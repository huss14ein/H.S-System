/**
 * Single choke point: after any *manual* commodity/AI quote fetch, write
 * localStorage + market_quote_cache + session simulatedPrices so canonical KPIs
 * (which prefer live quote × qty over holdings.currentValue) stay consistent.
 */
import type { Dispatch, SetStateAction } from 'react';
import {
  loadQuoteCacheRows,
  persistCommodityQuotePrices,
  type CachedQuoteRow,
} from './quotePriceCache';
import type { LiveQuoteRow } from './finnhubService';
import {
  upsertMarketQuotesToDb,
  type MarketQuoteDbClient,
} from './marketQuoteDbCache';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';

export type CommodityPriceTick = { symbol: string; price: number };

function buildSessionPatch(
  prices: CommodityPriceTick[],
  prev: SimulatedPriceMap,
): Record<string, LiveQuoteRow> {
  const patch: Record<string, LiveQuoteRow> = {};
  for (const cp of prices) {
    const sym = String(cp.symbol ?? '').trim();
    const price = Number(cp.price);
    if (!sym || !Number.isFinite(price) || price <= 0) continue;
    const oldPrice = Number(prev[sym]?.price) || price;
    const change = price - oldPrice;
    const changePercent = oldPrice > 0 ? (change / oldPrice) * 100 : 0;
    patch[sym] = { price, change, changePercent };
  }
  return patch;
}

/** Persist commodity ticks everywhere KPIs can read them. */
export function applyManualCommodityQuotes(args: {
  prices: CommodityPriceTick[];
  setSimulatedPrices?: Dispatch<SetStateAction<SimulatedPriceMap>>;
  db?: MarketQuoteDbClient | null;
  priorCacheRows?: Record<string, CachedQuoteRow>;
}): Record<string, CachedQuoteRow> {
  const prices = (args.prices ?? []).filter(
    (p) => p?.symbol && Number.isFinite(Number(p.price)) && Number(p.price) > 0,
  );
  if (prices.length === 0) return args.priorCacheRows ?? loadQuoteCacheRows();

  const prior = args.priorCacheRows ?? loadQuoteCacheRows();
  const nextRows = persistCommodityQuotePrices(prior, prices);

  const dbMap: Record<string, LiveQuoteRow> = {};
  for (const p of prices) {
    dbMap[p.symbol] = { price: p.price, change: 0, changePercent: 0 };
  }
  void upsertMarketQuotesToDb(args.db ?? null, dbMap);

  if (args.setSimulatedPrices) {
    args.setSimulatedPrices((prev) => {
      const patch = buildSessionPatch(prices, prev);
      if (Object.keys(patch).length === 0) return prev;
      return { ...prev, ...patch };
    });
  }

  return nextRows;
}
