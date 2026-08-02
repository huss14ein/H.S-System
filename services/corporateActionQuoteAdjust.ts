/**
 * Scale cached live quotes after stock split / reverse split so headline NW stays stable.
 * Providers return split-adjusted prices; local cache must match until the next refresh.
 */
import type { CorporateAction } from './corporateActions';
import { splitRatio } from './corporateActions';
import { canonicalQuoteLookupKey } from './finnhubService';
import type { SimulatedPriceRow } from './investmentPlatformCardMetrics';

export type QuotePriceRow = SimulatedPriceRow;

export function splitQuoteAdjustRatio(action: CorporateAction): number | null {
  if (action.type !== 'stock_split' && action.type !== 'reverse_stock_split') return null;
  const ratio = splitRatio(action);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

/** Divide per-share quote fields by split ratio (2:1 split → price halves). */
export function scaleQuoteRowForSplit(row: QuotePriceRow, ratio: number): QuotePriceRow {
  if (!Number.isFinite(ratio) || ratio <= 0) return row;
  const price = row.price / ratio;
  const change = (Number(row.change) || 0) / ratio;
  const changePercent = Number.isFinite(row.changePercent) ? (row.changePercent as number) : 0;
  return { price, change, changePercent };
}

export function scaleQuotesForCorporateAction(
  prices: Record<string, QuotePriceRow>,
  symbol: string,
  action: CorporateAction,
): { prices: Record<string, QuotePriceRow>; changed: boolean } {
  const ratio = splitQuoteAdjustRatio(action);
  if (ratio == null) return { prices, changed: false };
  const targetCanon = canonicalQuoteLookupKey(symbol);
  if (!targetCanon) return { prices, changed: false };
  const keys = Object.keys(prices).filter((k) => canonicalQuoteLookupKey(k) === targetCanon);
  if (keys.length === 0) return { prices, changed: false };
  const next = { ...prices };
  let changed = false;
  for (const k of keys) {
    const row = next[k];
    if (!row || !Number.isFinite(row.price) || row.price <= 0) continue;
    next[k] = scaleQuoteRowForSplit(row, ratio);
    changed = true;
  }
  return { prices: changed ? next : prices, changed };
}
