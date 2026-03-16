/**
 * Fetches and caches company name for ticker symbols via Finnhub API.
 * Fallback: static map when API fails; then symbol as display name so auto-retrieve always works.
 */

import { useState, useEffect } from 'react';
import { getCompanyProfile } from '../services/finnhubService';
import { getStaticCompanyName } from '../services/staticCompanyNameService';

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

async function fetchAndCache(symbol: string): Promise<string | null> {
  const key = symbol.trim().toUpperCase();
  if (!key || key.length < 2) return null;
  if (cache.has(key)) return cache.get(key)!;
  if (pending.has(key)) return pending.get(key)!;

  const p = (async (): Promise<string | null> => {
    let name: string | null = null;
    try {
      const profile = await getCompanyProfile(key);
      name = profile?.name ?? null;
    } catch {
      // API key missing, network error, or rate limit – use fallbacks
    }
    if (!name) name = getStaticCompanyName(key);
    if (!name) name = key; // always show something: use symbol as display name
    cache.set(key, name);
    pending.delete(key);
    return name;
  })();
  pending.set(key, p);
  return p;
}

/** Get company name for one symbol. Returns { name, loading }. Cached. */
export function useCompanyName(symbol: string | null): { name: string | null | undefined; loading: boolean } {
  const key = symbol?.trim().toUpperCase() ?? '';
  const [name, setName] = useState<string | null | undefined>(() => (key ? cache.get(key) : undefined));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key || key.length < 2) {
      setName(undefined);
      setLoading(false);
      return;
    }
    const cached = cache.get(key);
    if (cached !== undefined) {
      setName(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAndCache(key).then((n) => {
      setName(n);
      setLoading(false);
    });
  }, [key]);

  return { name: key ? name : undefined, loading };
}

/** Fetch company name for a symbol (e.g. on blur). Resolves with cached or API result. */
export async function fetchCompanyNameForSymbol(symbol: string): Promise<string | null> {
  const key = symbol.trim().toUpperCase();
  if (!key || key.length < 2) return null;
  return fetchAndCache(key);
}

/** Batch: resolve company names for multiple symbols. Returns map symbol -> name. Used for holdings list. */
export function useCompanyNames(symbols: string[]): { names: Record<string, string | null>; loading: boolean } {
  const deduped = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length >= 2)));
  const [names, setNames] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    deduped.forEach((s) => {
      const v = cache.get(s);
      if (v !== undefined) initial[s] = v;
    });
    return initial;
  });
  const [loading, setLoading] = useState(false);

  const symbolsKey = symbols.slice().sort().join(',');
  useEffect(() => {
    const toFetch = deduped.filter((s) => !cache.has(s));
    if (toFetch.length === 0) {
      const next: Record<string, string | null> = {};
      deduped.forEach((s) => { next[s] = cache.get(s) ?? null; });
      setNames(next);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(toFetch.map((s) => fetchAndCache(s))).then(() => {
      const next: Record<string, string | null> = {};
      deduped.forEach((s) => { next[s] = cache.get(s) ?? null; });
      setNames(next);
      setLoading(false);
    });
  }, [symbolsKey]);

  return { names, loading };
}
