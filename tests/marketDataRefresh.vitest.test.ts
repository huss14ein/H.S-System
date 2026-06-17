import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('market data refresh wiring', () => {
  it('force refresh queues during cooldown instead of cancelling', () => {
    const ctx = read('context/MarketDataContext.tsx');
    expect(ctx).not.toContain('isQuoteRefreshInCooldown() && options?.forceFetch === true');
    expect(ctx).not.toMatch(/if \(scopedForce\) return/);
    expect(ctx).toContain('forceFetch: force, manual: true');
  });

  it('header refresh stays enabled during rate-limit cooldown', () => {
    const header = read('components/Header.tsx');
    expect(header).toMatch(/refreshPrices\(\{ forceFetch: true \}\)/);
    expect(header).not.toMatch(/disabled=\{headerRefreshing \|\| quoteCooldownSec > 0\}/);
  });

  it('MarketSimulator drains pending symbols after cooldown for manual sessions', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).toContain('pendingLiveFetchSymbolsRef.current.length > 0');
    expect(sim).toContain('isManualRefreshSession');
    expect(sim).toContain('pendingLiveFetchSymbolsRef.current = []');
    expect(sim).toContain('priceScope.manual === true && forceFetch');
    expect(sim).toContain('isManualRefreshSession?.()');
  });
});
