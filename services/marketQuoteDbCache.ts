/**
 * Persist / restore live quotes in Supabase `market_quote_cache` so a manual refresh
 * survives new devices and cleared localStorage — without auto-polling providers.
 */
import type { CachedQuoteRow } from './quotePriceCache';
import { loadQuoteCacheRows, saveQuoteCacheRows } from './quotePriceCache';
import { canonicalQuoteLookupKey } from './finnhubService';

export type MarketQuoteDbClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
    };
  };
  rpc: (
    fn: string,
    args: object,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

export type MarketQuoteUpsertRow = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  fetchedAt: number;
};

function cacheKeysForSymbol(symbol: string): string[] {
  const raw = symbol.trim();
  return Array.from(new Set([raw, raw.toUpperCase(), canonicalQuoteLookupKey(raw)])).filter(Boolean);
}

/** Build upsert payload from a live quote map (one row per canonical symbol). */
export function buildMarketQuoteUpsertRows(
  quotes: Record<string, { price: number; change?: number; changePercent?: number }>,
  fetchedAtMs: number = Date.now(),
): MarketQuoteUpsertRow[] {
  const byCanon = new Map<string, MarketQuoteUpsertRow>();
  for (const [raw, row] of Object.entries(quotes)) {
    const price = Number(row?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const symbol = canonicalQuoteLookupKey(raw) || raw.trim().toUpperCase();
    if (!symbol) continue;
    byCanon.set(symbol, {
      symbol,
      price,
      change: Number(row.change) || 0,
      changePercent: Number(row.changePercent) || 0,
      fetchedAt: fetchedAtMs,
    });
  }
  return Array.from(byCanon.values());
}

/** Upsert trusted quotes after a user-initiated live fetch. No-ops when RPC missing. */
export async function upsertMarketQuotesToDb(
  db: MarketQuoteDbClient | null | undefined,
  quotes: Record<string, { price: number; change?: number; changePercent?: number }>,
  fetchedAtMs: number = Date.now(),
): Promise<number> {
  if (!db) return 0;
  const rows = buildMarketQuoteUpsertRows(quotes, fetchedAtMs);
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    symbol: r.symbol,
    price: r.price,
    change: r.change,
    change_percent: r.changePercent,
    fetched_at: new Date(r.fetchedAt).toISOString(),
  }));
  try {
    const { data, error } = await db.rpc('upsert_market_quote_cache', { p_rows: payload });
    if (error) {
      const missing =
        error.code === 'PGRST202' ||
        (String(error.message ?? '').toLowerCase().includes('function') &&
          String(error.message ?? '').toLowerCase().includes('does not exist'));
      if (!missing) console.warn('market_quote_cache upsert failed:', error.message);
      return 0;
    }
    return Number(data) || rows.length;
  } catch (e) {
    console.warn('market_quote_cache upsert error:', e);
    return 0;
  }
}

export type SeedFromDbResult = {
  rows: Record<string, CachedQuoteRow>;
  seededSymbols: string[];
  changed: boolean;
};

/** Merge DB rows into local quote cache (DB wins when strictly newer). */
export function mergeMarketQuoteCacheRowsFromDb(
  local: Record<string, CachedQuoteRow>,
  dbRows: Array<{
    symbol?: string;
    price?: number;
    change?: number;
    change_percent?: number;
    changePercent?: number;
    fetched_at?: string;
    fetchedAt?: string;
  }>,
): SeedFromDbResult {
  const next: Record<string, CachedQuoteRow> = { ...local };
  const seededSymbols: string[] = [];
  let changed = false;

  for (const raw of dbRows ?? []) {
    const symbol = String(raw.symbol ?? '').trim();
    const price = Number(raw.price);
    const fetchedIso = raw.fetched_at ?? raw.fetchedAt;
    const fetchedAt = fetchedIso ? Date.parse(String(fetchedIso)) : Number.NaN;
    if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
      continue;
    }
    const change = Number(raw.change) || 0;
    const changePercent = Number(raw.change_percent ?? raw.changePercent) || 0;
    const keys = cacheKeysForSymbol(symbol);
    let newestLocalMs = 0;
    for (const key of keys) {
      const row = next[key];
      if (row && Number.isFinite(row.fetchedAt) && row.fetchedAt > newestLocalMs) {
        newestLocalMs = row.fetchedAt;
      }
    }
    if (newestLocalMs >= fetchedAt) continue;
    for (const key of keys) {
      next[key] = { price, change, changePercent, fetchedAt };
    }
    seededSymbols.push(symbol.toUpperCase());
    changed = true;
  }

  return { rows: changed ? next : local, seededSymbols, changed };
}

/** Load `market_quote_cache` for the user and merge into localStorage. */
export async function seedQuoteCacheFromMarketQuoteDb(
  db: MarketQuoteDbClient | null | undefined,
  userId: string | null | undefined,
): Promise<SeedFromDbResult> {
  const empty: SeedFromDbResult = { rows: loadQuoteCacheRows(), seededSymbols: [], changed: false };
  if (!db || !userId) return empty;
  try {
    const { data, error } = await db.from('market_quote_cache').select('symbol, price, change, change_percent, fetched_at').eq('user_id', userId);
    if (error || !Array.isArray(data)) {
      const missing =
        error?.code === '42P01' ||
        String(error?.message ?? '').toLowerCase().includes('does not exist') ||
        String(error?.message ?? '').toLowerCase().includes('schema cache');
      if (error && !missing) console.warn('market_quote_cache load failed:', error.message);
      return empty;
    }
    const local = loadQuoteCacheRows();
    const merged = mergeMarketQuoteCacheRowsFromDb(local, data as any[]);
    if (merged.changed) saveQuoteCacheRows(merged.rows);
    return merged;
  } catch (e) {
    console.warn('market_quote_cache load error:', e);
    return empty;
  }
}
