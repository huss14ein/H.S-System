/**
 * Coordinates live quote network calls: dedupes identical in-flight batches
 * so overlapping refresh scopes do not multiply provider requests.
 */
import { getLivePrices } from './geminiService';

type LiveQuoteRow = { price: number; change: number; changePercent: number };

const batchInFlight = new Map<string, Promise<Record<string, LiveQuoteRow>>>();

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

  const promise = getLivePrices(normalized).finally(() => {
    batchInFlight.delete(key);
  });
  batchInFlight.set(key, promise);
  return promise;
}

/** Test helper — clears in-flight map. */
export function resetLivePriceFetchCoordinatorForTests(): void {
  batchInFlight.clear();
}
