import { describe, it, expect, vi } from 'vitest';
import { cachedSupabaseQuery, invalidateSupabaseQueryCache } from '../services/supabaseQueryCache';

describe('supabaseQueryCache', () => {
  it('dedupes in-flight loaders for the same key', async () => {
    invalidateSupabaseQueryCache();
    let calls = 0;
    const loader = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 'ok';
    });

    const [a, b] = await Promise.all([
      cachedSupabaseQuery('test:dedupe', loader, 60_000),
      cachedSupabaseQuery('test:dedupe', loader, 60_000),
    ]);

    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(calls).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns cached value within TTL without re-calling loader', async () => {
    invalidateSupabaseQueryCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 42;
    };

    await cachedSupabaseQuery('test:ttl', loader, 60_000);
    await cachedSupabaseQuery('test:ttl', loader, 60_000);

    expect(calls).toBe(1);
  });
});
