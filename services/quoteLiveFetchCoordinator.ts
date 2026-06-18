/**
 * Coordinates live quote network calls: dedupes identical in-flight batches
 * so overlapping refresh scopes do not multiply provider requests.
 * Every successful batch is sanitized and persisted to localStorage.
 */
import { getLivePrices } from './geminiService';
import {
  buildDisplayMapFromCachedRows,
  loadQuoteCacheRows,
  persistSanitizedLiveQuotes,
  sanitizeLiveQuoteBatch,
} from './quotePriceCache';
import { syncQuoteCacheToSessionNow } from '../utils/quoteRefreshBridge';

type LiveQuoteRow = { price: number; change: number; changePercent: number };

const batchInFlight = new Map<string, Promise<Record<string, LiveQuoteRow>>>();

/** Finnhub queue gap (~1.1s/symbol) — timeout must exceed worst-case batch size. */
export const FINNHUB_MIN_GAP_MS = 1100;

export function liveFetchTimeoutMs(symbolCount: number): number {
  if (symbolCount <= 0) return 25_000;
  return Math.min(90_000, Math.max(25_000, symbolCount * FINNHUB_MIN_GAP_MS + 8_000));
}

function batchKey(symbols: string[]): string {
  return symbols
    .map((s) => (s || '').trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join('\0');
}

/** Same as `getLivePrices` but shares one promise per unique symbol set while in flight. */
export async function getLivePricesDeduped(symbols: string[]): Promise<Record<string, LiveQuoteRow>> {
  const normalized = Array.from(
    new Set(symbols.map((s) => (s || '').trim()).filter(Boolean)),
  );
  if (normalized.length === 0) return {};

  const key = batchKey(normalized);
  const existing = batchInFlight.get(key);
  if (existing) return existing;

  let timedResolvedEarly = false;

  const promise = getLivePrices(normalized)
    .then((raw) => {
      if (Object.keys(raw).length === 0) return raw;
      persistSanitizedLiveQuotes(normalized, raw, loadQuoteCacheRows());
      const sanitized = sanitizeLiveQuoteBatch(raw);
      if (timedResolvedEarly && Object.keys(sanitized).length > 0) {
        syncQuoteCacheToSessionNow();
      }
      return sanitized;
    })
    .finally(() => {
      batchInFlight.delete(key);
    });

  const timeoutMs = liveFetchTimeoutMs(normalized.length);
  const timed = new Promise<Record<string, LiveQuoteRow>>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedResolvedEarly = true;
      const fromCache = buildDisplayMapFromCachedRows(normalized, loadQuoteCacheRows()) as Record<
        string,
        LiveQuoteRow
      >;
      if (Object.keys(fromCache).length > 0) {
        resolve(fromCache);
        return;
      }
      reject(new Error('Live quote fetch timed out'));
    }, timeoutMs);
    promise.then(
      (rows) => {
        clearTimeout(timer);
        timedResolvedEarly = false;
        resolve(rows);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

  batchInFlight.set(key, timed);
  return timed;
}

/** Test helper — clears in-flight map. */
export function resetLivePriceFetchCoordinatorForTests(): void {
  batchInFlight.clear();
}
