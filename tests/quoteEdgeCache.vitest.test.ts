import { describe, expect, it } from 'vitest';
import {
  getQuoteEdgeCached,
  quoteEdgeCacheKey,
  quoteEdgeCacheStats,
  setQuoteEdgeCached,
} from '../netlify/functions/quoteEdgeCache';

describe('quoteEdgeCache', () => {
  it('stores and returns cached quote responses', () => {
    const key = quoteEdgeCacheKey('sahmk', '2222');
    expect(getQuoteEdgeCached(key)).toBeNull();
    setQuoteEdgeCached(key, { status: 200, body: '{"ok":true}', contentType: 'application/json' });
    const hit = getQuoteEdgeCached(key);
    expect(hit?.status).toBe(200);
    expect(hit?.body).toContain('ok');
    expect(quoteEdgeCacheStats().size).toBeGreaterThan(0);
  });

  it('normalizes cache keys', () => {
    expect(quoteEdgeCacheKey('stooq', ' abc ')).toBe('stooq:ABC');
  });
});
