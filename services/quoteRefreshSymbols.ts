import type { Holding } from '../types';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import { isTadawulQuoteSymbol } from './marketQuoteRouting';
import { symbolForLiveQuoteFetch } from './tadawulQuoteSanity';

type HoldingLike = Partial<Pick<Holding, 'symbol' | 'holdingType'>> & { holding_type?: string };

/**
 * Refresh only quoted ticker holdings.
 * Manual-valued holdings keep their stored currentValue and should never consume quote API quota.
 */
export function holdingCanUseQuoteRefresh(holding: HoldingLike): boolean {
  if (!holdingUsesLiveQuote(holding)) return false;
  return isRefreshableHoldingQuoteSymbol(holding.symbol);
}

/**
 * Whether this holding symbol can receive live quotes (Tadawul: bare code, `.SR`, `.SA`, `.SE`, `TADAWUL:`).
 */
export function isRefreshableHoldingQuoteSymbol(symbol: string | null | undefined): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (isTadawulQuoteSymbol(upper)) return true;
  return /^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$/.test(upper);
}

/** Canonical symbol sent to live providers (Tadawul aliases → `CODE.SR`). */
export function refreshableQuoteFetchSymbol(symbol: string): string {
  const s = String(symbol ?? '').trim();
  if (!s) return s;
  if (isTadawulQuoteSymbol(s)) return symbolForLiveQuoteFetch(s);
  return s;
}

export function getRefreshableHoldingQuoteSymbols(holdings: HoldingLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of holdings) {
    if (!holdingCanUseQuoteRefresh(h)) continue;
    const raw = h.symbol;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const fetchSym = refreshableQuoteFetchSymbol(raw);
    const key = fetchSym.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fetchSym);
  }
  return out;
}
