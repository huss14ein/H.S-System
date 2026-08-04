/**
 * Read persisted holding prices (`holdings.current_price` / `price_updated_at`) back into the
 * local quote cache, so the last trusted API quote survives more than the browser that fetched it:
 * a new device, cleared storage, or private window shows real prices before the first live fetch,
 * and a newer price saved by another session wins over an older local row.
 *
 * Day change is not persisted, so seeded rows report 0 change until a live quote arrives —
 * a fabricated change would show up as a fake daily P/L.
 */
import type { InvestmentPortfolio } from '../types';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { canonicalQuoteLookupKey } from './finnhubService';
import { loadQuoteCacheRows, saveQuoteCacheRows, type CachedQuoteRow } from './quotePriceCache';
import { holdingCanUseQuoteRefresh } from './quoteRefreshSymbols';

export type PersistedHoldingQuoteSeedResult = {
  rows: Record<string, CachedQuoteRow>;
  /** Symbols whose price came from the database instead of local cache. */
  seededSymbols: string[];
  changed: boolean;
};

function cacheKeysForSymbol(symbol: string): string[] {
  const raw = symbol.trim();
  return Array.from(new Set([raw, raw.toUpperCase(), canonicalQuoteLookupKey(raw)])).filter(Boolean);
}

/** Pure merge: DB price wins only when strictly newer than every local alias row.
 * When `currentPrice` is missing, derive unit price from `currentValue / quantity` so
 * legacy rows still seed the session and stop showing perpetual "Stored" after refresh.
 */
export function buildQuoteCacheRowsFromPersistedHoldingPrices(
  portfolios: InvestmentPortfolio[],
  rows: Record<string, CachedQuoteRow>,
): PersistedHoldingQuoteSeedResult {
  const next: Record<string, CachedQuoteRow> = { ...rows };
  const seededSymbols: string[] = [];
  let changed = false;

  for (const portfolio of portfolios ?? []) {
    const book = resolveInvestmentPortfolioCurrency(portfolio);
    for (const holding of portfolio.holdings ?? []) {
      if (!holdingCanUseQuoteRefresh(holding, { bookCurrency: book })) continue;
      const symbol = String(holding.symbol ?? '').trim();
      const qty = Number(holding.quantity);
      let price = Number(holding.currentPrice);
      let persistedMs = holding.priceUpdatedAt ? Date.parse(holding.priceUpdatedAt) : Number.NaN;
      if ((!Number.isFinite(price) || price <= 0) && Number.isFinite(qty) && qty > 0) {
        const value = Number(holding.currentValue);
        if (Number.isFinite(value) && value > 0) {
          price = value / qty;
          // Epoch so any real live/cache quote still wins over a derived mark.
          if (!Number.isFinite(persistedMs) || persistedMs <= 0) persistedMs = 1;
        }
      }
      if (
        !symbol ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(persistedMs) ||
        persistedMs <= 0
      ) {
        continue;
      }

      const keys = cacheKeysForSymbol(symbol);
      let newestLocalMs = 0;
      for (const key of keys) {
        const row = next[key];
        if (row && Number.isFinite(row.fetchedAt) && row.fetchedAt > newestLocalMs) {
          newestLocalMs = row.fetchedAt;
        }
      }
      if (newestLocalMs >= persistedMs) continue;

      for (const key of keys) {
        next[key] = { price, change: 0, changePercent: 0, fetchedAt: persistedMs };
      }
      seededSymbols.push(symbol.toUpperCase());
      changed = true;
    }
  }

  return { rows: changed ? next : rows, seededSymbols, changed };
}

/**
 * Merge + persist, so TTL planning (`symbolsNeedingLiveFetch`) treats a fresh database price as
 * fresh and does not spend an API call re-fetching it.
 */
export function seedQuoteCacheFromPersistedHoldingPrices(
  portfolios: InvestmentPortfolio[],
  rows: Record<string, CachedQuoteRow> = loadQuoteCacheRows(),
): PersistedHoldingQuoteSeedResult {
  const result = buildQuoteCacheRowsFromPersistedHoldingPrices(portfolios, rows);
  if (result.changed) saveQuoteCacheRows(result.rows);
  return result;
}
