/**
 * Period-start marks for week/month portfolio P/L.
 * Uses dated daily closes so start value is mark-to-market at period open — not cost basis
 * (cost-at-start made Week/Month ≈ lifetime unrealized).
 */
import type { InvestmentPortfolio } from '../types';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { getStockDailyClosesDated, type DatedClose } from './finnhubService';
import { canonicalQuoteLookupKey } from './finnhubService';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';

const CACHE_TTL_MS = 15 * 60 * 1000;
const closesCache = new Map<string, { at: number; closes: DatedClose[] }>();

/** Last close on or before `asOfMs` (inclusive). */
export function closeOnOrBefore(closes: DatedClose[], asOfMs: number): number | undefined {
  if (!(asOfMs > 0) || closes.length === 0) return undefined;
  let best: number | undefined;
  for (const row of closes) {
    if (!(row.dayMs <= asOfMs)) break;
    if (Number.isFinite(row.price) && row.price > 0) best = row.price;
  }
  return best;
}

/** Expand a single symbol price into common quote aliases for lookupLiveQuoteForSymbol. */
export function priceMapWithAliases(symbol: string, price: number): SimulatedPriceMap {
  const raw = String(symbol ?? '').trim();
  if (!raw || !(price > 0)) return {};
  const upper = raw.toUpperCase();
  const canon = canonicalQuoteLookupKey(upper);
  const out: SimulatedPriceMap = {
    [raw]: { price },
    [upper]: { price },
    [canon]: { price },
  };
  const bare = upper.replace(/\.(SR|SA|SE)$/i, '');
  if (bare && bare !== upper) {
    out[bare] = { price };
    out[`${bare}.SR`] = { price };
  }
  return out;
}

export function buildPriceMapAtAsOf(
  closesBySymbol: Record<string, DatedClose[]>,
  asOfMs: number,
): SimulatedPriceMap {
  let merged: SimulatedPriceMap = {};
  for (const [sym, closes] of Object.entries(closesBySymbol)) {
    const px = closeOnOrBefore(closes, asOfMs);
    if (px == null) continue;
    merged = { ...merged, ...priceMapWithAliases(sym, px) };
  }
  return merged;
}

export function collectQuoteBackedHoldingSymbols(portfolios: InvestmentPortfolio[]): string[] {
  const out = new Set<string>();
  for (const p of portfolios ?? []) {
    for (const h of p.holdings ?? []) {
      if (!holdingUsesLiveQuote(h)) continue;
      const sym = String(h.symbol ?? '').trim();
      if (sym) out.add(sym);
    }
  }
  return [...out];
}

async function loadDatedClosesCached(symbol: string): Promise<DatedClose[]> {
  const key = symbol.trim().toUpperCase();
  const hit = closesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.closes;
  const closes = await getStockDailyClosesDated(symbol);
  closesCache.set(key, { at: Date.now(), closes });
  return closes;
}

/** Fetch daily closes for holdings and build a SimulatedPriceMap as of `asOfMs`. */
export async function fetchPeriodStartPriceMap(
  portfolios: InvestmentPortfolio[],
  asOfMs: number,
): Promise<SimulatedPriceMap> {
  const symbols = collectQuoteBackedHoldingSymbols(portfolios);
  if (symbols.length === 0 || !(asOfMs > 0)) return {};
  const closesBySymbol: Record<string, DatedClose[]> = {};
  await Promise.all(
    symbols.map(async (sym) => {
      closesBySymbol[sym] = await loadDatedClosesCached(sym);
    }),
  );
  return buildPriceMapAtAsOf(closesBySymbol, asOfMs);
}

/** Load dated closes once for sparkline day marks. */
export async function fetchDatedClosesForPortfolios(
  portfolios: InvestmentPortfolio[],
): Promise<Record<string, DatedClose[]>> {
  const symbols = collectQuoteBackedHoldingSymbols(portfolios);
  const closesBySymbol: Record<string, DatedClose[]> = {};
  await Promise.all(
    symbols.map(async (sym) => {
      closesBySymbol[sym] = await loadDatedClosesCached(sym);
    }),
  );
  return closesBySymbol;
}

/** Test helper — clear candle cache between cases. */
export function clearPeriodStartMarksCacheForTests(): void {
  closesCache.clear();
}
