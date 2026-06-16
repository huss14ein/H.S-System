/**
 * Fetches and caches company names for ticker symbols: static map first, then Finnhub profile2.
 * Cache key is normalized (e.g. TADAWUL:2222 and 2222.SR share one entry).
 */

import { useState, useEffect } from 'react';
import { getCompanyProfileCached } from '../services/finnhubService';
import { getStaticCompanyName, normalizeSymbolKeyForCompanyLookup } from '../services/staticCompanyNameService';

/** undefined = not yet loaded; null = no display name found (UI may show symbol); string = resolved name */
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const FETCH_CONCURRENCY = 4;

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  if (items.length === 0) return;
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

async function fetchAndCache(rawSymbol: string): Promise<string | null> {
  const key = normalizeSymbolKeyForCompanyLookup(rawSymbol);
  if (!key || key.length < 2) return null;
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;

  const p = (async (): Promise<string | null> => {
    const staticName = getStaticCompanyName(key);
    if (staticName) {
      cache.set(key, staticName);
      pending.delete(key);
      return staticName;
    }
    let resolved: string | null = null;
    try {
      const profile = await getCompanyProfileCached(key);
      const n = profile?.name?.trim();
      if (n) resolved = n;
    } catch {
      // API key missing, network error, or rate limit
    }
    if (!resolved) {
      resolved = getStaticCompanyName(key);
    }
    cache.set(key, resolved);
    pending.delete(key);
    return resolved;
  })();
  pending.set(key, p);
  return p;
}

/** Symbols that still need a Finnhub/static lookup (skip when holding already has a name). */
export function symbolsNeedingCompanyName(
  entries: Array<{ symbol?: string | null; name?: string | null }>,
): string[] {
  return Array.from(
    new Set(
      entries
        .filter((e) => {
          const s = (e.symbol || '').trim();
          if (s.length < 2) return false;
          if (e.name?.trim()) return false;
          return true;
        })
        .map((e) => normalizeSymbolKeyForCompanyLookup((e.symbol || '').trim())),
    ),
  ).filter((s) => s.length >= 2);
}

/** Test helper — clear hook-level name cache. */
export function clearCompanyNameHookCacheForTests(): void {
  cache.clear();
  pending.clear();
}

/** Get company name for one symbol. Returns { name, loading }. Cached. Falls back to symbol for display when unknown. */
export function useCompanyName(symbol: string | null): { name: string | null | undefined; loading: boolean } {
  const key = symbol ? normalizeSymbolKeyForCompanyLookup(symbol) : '';
  const [name, setName] = useState<string | null | undefined>(() => (key ? cache.get(key) : undefined));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key || key.length < 2) {
      setName(undefined);
      setLoading(false);
      return;
    }
    const staticName = getStaticCompanyName(key);
    if (staticName) {
      cache.set(key, staticName);
      setName(staticName);
      setLoading(false);
      return;
    }
    const cached = cache.get(key);
    if (cached !== undefined) {
      setName(cached === null ? key : cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAndCache(key).then((n) => {
      setName(n ?? key);
      setLoading(false);
    });
  }, [key]);

  return { name: key ? name : undefined, loading };
}

/** Fetch company name for a symbol (e.g. on blur). Returns real name or null — never the raw ticker. */
export async function fetchCompanyNameForSymbol(symbol: string): Promise<string | null> {
  const key = normalizeSymbolKeyForCompanyLookup(symbol);
  if (!key || key.length < 2) return null;
  return fetchAndCache(key);
}

/** Batch: resolve company names for multiple symbols. Map values are display names (symbol fallback if unknown). */
export function useCompanyNames(symbols: string[]): { names: Record<string, string | null>; loading: boolean } {
  const deduped = Array.from(
    new Set(symbols.map((s) => normalizeSymbolKeyForCompanyLookup(s)).filter((s) => s.length >= 2)),
  );
  const [names, setNames] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    deduped.forEach((s) => {
      const staticName = getStaticCompanyName(s);
      if (staticName) {
        cache.set(s, staticName);
        initial[s] = staticName;
        return;
      }
      const v = cache.get(s);
      if (v !== undefined) initial[s] = v === null ? s : v;
    });
    return initial;
  });
  const [loading, setLoading] = useState(false);

  const symbolsKey = symbols.slice().sort().join(',');
  useEffect(() => {
    const toFetch = deduped.filter((s) => !cache.has(s));
    if (toFetch.length === 0) {
      const next: Record<string, string | null> = {};
      deduped.forEach((s) => {
        const v = cache.get(s);
        next[s] = v === undefined ? null : v === null ? s : v;
      });
      setNames(next);
      setLoading(false);
      return;
    }
    setLoading(true);
    void runPool(toFetch, async (s) => {
      await fetchAndCache(s);
    }, FETCH_CONCURRENCY).then(() => {
      const next: Record<string, string | null> = {};
      deduped.forEach((s) => {
        const v = cache.get(s);
        next[s] = v === undefined ? null : v === null ? s : v;
      });
      setNames(next);
      setLoading(false);
    });
  }, [symbolsKey]);

  return { names, loading };
}
