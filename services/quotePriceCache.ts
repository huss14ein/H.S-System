/**
 * Persists last successful equity quotes in localStorage so we reuse them between sessions
 * and optionally skip network refreshes while entries are fresh (reduces Finnhub / provider usage).
 */

import { canonicalQuoteLookupKey, expandLiveQuotesForRequestedSymbols, type LiveQuoteRow } from './finnhubService';
import { isTadawulQuoteSymbol } from './marketQuoteRouting';
import { sanitizeLiveQuoteRow } from './tadawulQuoteSanity';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';

export const QUOTE_CACHE_STORAGE_KEY = 'finova-quote-cache-v1';

/** Default: refresh a symbol at most once per 15 minutes unless user forces refresh. */
export const QUOTE_CACHE_TTL_MS = 15 * 60 * 1000;

export type CachedQuoteRow = LiveQuoteRow & { fetchedAt: number };

type PersistedFile = {
  v: 1;
  /** Multiple keys may reference the same quote (user symbol + canonical); values share fetchedAt. */
  rows: Record<string, CachedQuoteRow>;
};

function safeParse(raw: string | null): PersistedFile | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as PersistedFile;
    if (j?.v !== 1 || !j.rows || typeof j.rows !== 'object') return null;
    return j;
  } catch {
    return null;
  }
}

export function loadQuoteCacheRows(): Record<string, CachedQuoteRow> {
  if (typeof localStorage === 'undefined') return {};
  const f = safeParse(localStorage.getItem(QUOTE_CACHE_STORAGE_KEY));
  return f?.rows ?? {};
}

/** Price triples only (MarketDataContext shape) — no timestamps. */
export function cacheRowsToSimulatedMap(rows: Record<string, CachedQuoteRow>): SimulatedPriceMap {
  const out: SimulatedPriceMap = {};
  for (const [k, v] of Object.entries(rows)) {
    if (!Number.isFinite(v.price) || v.price <= 0) continue;
    const row = { price: v.price, change: v.change ?? 0, changePercent: v.changePercent ?? 0 };
    const safe = isTadawulQuoteSymbol(k) ? sanitizeLiveQuoteRow(k, row) : row;
    if (!safe) continue;
    out[k] = { price: safe.price, change: safe.change ?? 0, changePercent: safe.changePercent ?? 0 };
  }
  return out;
}

export function isQuoteFresh(entry: CachedQuoteRow | undefined, ttlMs: number = QUOTE_CACHE_TTL_MS): boolean {
  if (!entry || !Number.isFinite(entry.fetchedAt)) return false;
  return Date.now() - entry.fetchedAt < ttlMs;
}

/**
 * Symbols that need a live fetch: missing from cache or older than TTL (checked via canonical + aliases).
 */
/**
 * Symbols to request from live providers. Manual refresh passes `forceFetch: true` so
 * user-initiated sync always hits the network even when cache TTL has not expired.
 */
export function resolveSymbolsToLiveFetch(
  requestedSymbols: string[],
  rows: Record<string, CachedQuoteRow>,
  options?: { forceFetch?: boolean; ttlMs?: number },
): string[] {
  if (options?.forceFetch) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of requestedSymbols) {
      const s = (raw || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }
  return symbolsNeedingLiveFetch(requestedSymbols, rows, options?.ttlMs ?? QUOTE_CACHE_TTL_MS);
}

export function symbolsNeedingLiveFetch(
  requestedSymbols: string[],
  rows: Record<string, CachedQuoteRow>,
  ttlMs: number = QUOTE_CACHE_TTL_MS,
): string[] {
  const need: string[] = [];
  const seen = new Set<string>();
  for (const raw of requestedSymbols) {
    const s = (raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const candidates = [s, s.toUpperCase(), canonicalQuoteLookupKey(s)];
    let fresh = false;
    for (const k of candidates) {
      const e = rows[k];
      if (isQuoteFresh(e, ttlMs)) {
        fresh = true;
        break;
      }
    }
    if (!fresh) need.push(s);
  }
  return need;
}

/**
 * Merge API result into persisted rows (updates fetchedAt), duplicate aliases via expandLiveQuotes.
 */
export function upsertCacheFromLiveQuotes(
  prior: Record<string, CachedQuoteRow>,
  requestedSymbols: string[],
  live: Record<string, LiveQuoteRow>,
): Record<string, CachedQuoteRow> {
  const expanded = expandLiveQuotesForRequestedSymbols(requestedSymbols, live);
  const now = Date.now();
  const next = { ...prior };
  for (const [k, row] of Object.entries(expanded)) {
    if (!row || !Number.isFinite(row.price) || row.price <= 0) continue;
    const safe = isTadawulQuoteSymbol(k) ? sanitizeLiveQuoteRow(k, row) : row;
    if (!safe) continue;
    next[k] = {
      price: safe.price,
      change: safe.change ?? 0,
      changePercent: safe.changePercent ?? 0,
      fetchedAt: now,
    };
  }
  return next;
}

export function saveQuoteCacheRows(rows: Record<string, CachedQuoteRow>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedFile = { v: 1, rows };
    localStorage.setItem(QUOTE_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Merge cached + freshly fetched quote maps into one display map (fresh wins on key collision).
 */
export function mergeQuoteDisplayMaps(
  ...maps: SimulatedPriceMap[]
): SimulatedPriceMap {
  return Object.assign({}, ...maps.filter(Boolean));
}
