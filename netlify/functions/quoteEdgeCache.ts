/**
 * In-process quote response cache for Netlify functions (15m TTL).
 * Reduces duplicate SAHMK/Stooq upstream calls across warm instances — not Redis, but server-side.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 800;

type Cached = {
  status: number;
  body: string;
  contentType: string;
  expires: number;
};

const store = new Map<string, Cached>();

function prune(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expires <= now) store.delete(k);
  }
  if (store.size <= MAX_ENTRIES) return;
  const drop = store.size - MAX_ENTRIES;
  let i = 0;
  for (const k of store.keys()) {
    store.delete(k);
    if (++i >= drop) break;
  }
}

export function quoteEdgeCacheKey(provider: string, id: string): string {
  return `${provider}:${id.trim().toUpperCase()}`;
}

export function getQuoteEdgeCached(key: string): Cached | null {
  const row = store.get(key);
  if (!row) return null;
  if (row.expires <= Date.now()) {
    store.delete(key);
    return null;
  }
  return row;
}

export function setQuoteEdgeCached(
  key: string,
  entry: { status: number; body: string; contentType: string },
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  store.set(key, {
    ...entry,
    expires: Date.now() + Math.max(5_000, ttlMs),
  });
  prune();
}

export function quoteEdgeCacheStats(): { size: number } {
  return { size: store.size };
}
