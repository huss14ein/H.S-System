/**
 * Dedupe in-flight Supabase reads and hold short TTL results — cuts duplicate network on hydrate/navigation.
 */

type CacheEntry<T> = { at: number; value: T };

const resultCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 60_000;

export function invalidateSupabaseQueryCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    resultCache.clear();
    inflight.clear();
    return;
  }
  for (const key of [...resultCache.keys()]) {
    if (key.startsWith(keyPrefix)) resultCache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(keyPrefix)) inflight.delete(key);
  }
}

export async function cachedSupabaseQuery<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const hit = resultCache.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      resultCache.set(key, { at: Date.now(), value });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise as Promise<T>;
}

/** Cached RPC — key should include user id when result is user-scoped. */
export async function cachedSupabaseRpc<T>(
  key: string,
  rpc: () => PromiseLike<{ data: T; error: unknown }>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<{ data: T; error: unknown }> {
  return cachedSupabaseQuery(key, () => Promise.resolve(rpc()), ttlMs);
}

/** Cached head/count select — returns raw Supabase count response shape. */
export async function cachedSupabaseHeadCount(
  key: string,
  query: () => PromiseLike<{ count: number | null; error: unknown }>,
  ttlMs = 30_000,
): Promise<{ count: number | null; error: unknown }> {
  return cachedSupabaseQuery(key, () => Promise.resolve(query()), ttlMs);
}
