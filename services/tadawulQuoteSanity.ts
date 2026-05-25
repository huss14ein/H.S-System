import { isTadawulQuoteSymbol } from './marketQuoteRouting';
import type { LiveQuoteRow } from './finnhubService';

/** Typical Tadawul per-share range (SAR); outliers above this are rejected unless cost basis supports it. */
export const TADAWUL_SOFT_MAX_SAR_PER_SHARE = 15_000;
export const TADAWUL_HARD_MAX_SAR_PER_SHARE = 50_000;

export type TadawulQuoteSanityContext = {
  /** Per-share average cost in portfolio book currency (usually SAR). */
  avgCostPerShare?: number;
  /** Stored market value ÷ quantity when live quote is unavailable. */
  storedPricePerShare?: number;
};

function referencePerShare(ctx?: TadawulQuoteSanityContext): number | null {
  if (!ctx) return null;
  const candidates = [ctx.avgCostPerShare, ctx.storedPricePerShare]
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (candidates.length === 0) return null;
  return candidates[0];
}

/**
 * Some feeds return halalas (1/100 SAR) as if they were riyals (e.g. 3,200 vs 32).
 */
export function maybeConvertHalalasToRiyals(rawPrice: number, refPerShare: number | null): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return rawPrice;
  if (refPerShare != null && refPerShare > 0) {
    const ratio = rawPrice / refPerShare;
    if (ratio >= 75 && ratio <= 125) return rawPrice / 100;
    if (ratio >= 7_500 && ratio <= 12_500) return rawPrice / 10_000;
  }
  // Bare numeric Tadawul without cost basis: very large integers are often halalas.
  if (rawPrice >= 1_000 && rawPrice <= 500_000) {
    const scaled = rawPrice / 100;
    if (scaled >= 0.5 && scaled <= TADAWUL_SOFT_MAX_SAR_PER_SHARE) return scaled;
  }
  return rawPrice;
}

/**
 * Reject quotes that are implausible vs cost basis or absolute SAR bounds.
 */
export function isPlausibleTadawulPriceSAR(price: number, refPerShare: number | null): boolean {
  if (!Number.isFinite(price) || price < 0.01) return false;
  const max =
    refPerShare != null && refPerShare > 0
      ? Math.min(TADAWUL_HARD_MAX_SAR_PER_SHARE, Math.max(TADAWUL_SOFT_MAX_SAR_PER_SHARE, refPerShare * 25))
      : TADAWUL_SOFT_MAX_SAR_PER_SHARE;
  if (price > max) return false;

  if (refPerShare != null && refPerShare > 0) {
    const ratio = price / refPerShare;
    // Wrong listing, FX mix-up, or corrupt upstream — do not drive NW/KPIs.
    if (refPerShare >= 1 && refPerShare <= 5_000) {
      if (ratio < 0.35 || ratio > 3) return false;
    } else if (ratio < 0.02 || ratio > 50) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize a Tadawul per-share price in SAR (halala fix + plausibility).
 * Returns null when the quote should not be used (caller falls back to stored value / cost).
 */
export function normalizeTadawulUnitPriceSAR(
  rawPrice: number,
  ctx?: TadawulQuoteSanityContext,
): number | null {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  const ref = referencePerShare(ctx);
  let price = maybeConvertHalalasToRiyals(rawPrice, ref);
  if (!isPlausibleTadawulPriceSAR(price, ref)) return null;
  return price;
}

/** Map user holding symbols to the canonical fetch key (`.SR`) while keeping alias expansion downstream. */
export function symbolForLiveQuoteFetch(symbol: string): string {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return upper;
  if (/^[0-9]{4,6}$/.test(upper)) return `${upper}.SR`;
  const suffixed = upper.match(/^([A-Z0-9]{1,8})\.(SA|SE)$/);
  if (suffixed) return `${suffixed[1]}.SR`;
  const tad = upper.match(/^TADAWUL:([A-Z0-9]{1,8})$/);
  if (tad) return `${tad[1]}.SR`;
  return upper;
}

export function sanitizeLiveQuoteRow(
  symbol: string,
  row: LiveQuoteRow | undefined,
  ctx?: TadawulQuoteSanityContext,
): LiveQuoteRow | undefined {
  if (!row || !Number.isFinite(row.price) || row.price <= 0) return undefined;
  if (!isTadawulQuoteSymbol(symbol)) return row;

  const normalized = normalizeTadawulUnitPriceSAR(row.price, ctx);
  if (normalized == null) return undefined;

  if (normalized === row.price) return row;

  const prev = normalized - (Number.isFinite(row.change) ? row.change : 0);
  const safePrev = prev > 0 ? prev : normalized;
  const change = normalized - safePrev;
  const changePercent =
    Number.isFinite(row.changePercent) && row.changePercent !== 0
      ? row.changePercent
      : safePrev > 0
        ? (change / safePrev) * 100
        : 0;

  return {
    price: normalized,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
  };
}
