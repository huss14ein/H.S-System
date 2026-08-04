import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildQuoteCacheRowsFromPersistedHoldingPrices,
  seedQuoteCacheFromPersistedHoldingPrices,
} from '../services/persistedHoldingQuoteSeed';
import type { CachedQuoteRow } from '../services/quotePriceCache';
import type { Holding, InvestmentPortfolio } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const holding = (over: Partial<Holding> & { symbol: string }): Holding => ({
  id: `h-${over.symbol}`,
  quantity: 10,
  avgCost: 50,
  currentValue: 700,
  zakahClass: 'Zakatable',
  realizedPnL: 0,
  ...over,
});

const portfolioWith = (holdings: Holding[]): InvestmentPortfolio => ({
  id: 'pf1',
  name: 'Awaed',
  accountId: 'acc1',
  currency: 'USD',
  holdings,
});

describe('trusted holding market price persistence', () => {
  it('awaits trusted quote persistence before completing the refresh tick', () => {
    const simulator = read('components/MarketSimulator.tsx');
    expect(simulator).toContain('await batchUpdateHoldingValues(holdingUpdatesFiltered)');
    expect(simulator).toContain('buildEquityHoldingValueUpdatesFromTrustedSnapshot');
  });

  it('batch writer updates market columns only, never position-book fields', () => {
    const context = read('context/DataContext.tsx');
    const start = context.indexOf('const batchUpdateHoldingValues = async');
    const end = context.indexOf('const recordTrade = async', start);
    const block = context.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("rpc('update_holding_market_values'");
    expect(block).toContain('current_value');
    expect(block).toContain('current_price');
    expect(block).toContain('price_updated_at');
    expect(block).toContain('unrealized_pnl');
    expect(block).not.toContain('avg_cost');
    expect(block).not.toMatch(/update\(\{[^}]*quantity/);
  });

  it('local memory patch honors RPC skips when DB has a newer price_updated_at', () => {
    const context = read('context/DataContext.tsx');
    const start = context.indexOf('const batchUpdateHoldingValues = async');
    const block = context.slice(start, context.indexOf('const recordTrade = async', start));
    expect(block).toContain('const affected = Number(rpcResult.data)');
    expect(block).toContain('affected === 0');
    expect(block).toContain('affected < safeUpdates.length');
    expect(block).toContain(".select('id, current_value, current_price, price_updated_at, unrealized_pnl')");
    expect(block).toContain('appliedUpdates');
  });

  it('migration adds price fields and a user-scoped latest-wins RPC', () => {
    const migration = read(
      'supabase/migrations/20260725120000_holdings_market_price_persistence.sql',
    );
    expect(migration).toContain('add column if not exists current_price');
    expect(migration).toContain('add column if not exists price_updated_at');
    expect(migration).toContain('update_holding_market_values');
    expect(migration).toContain('h.user_id = auth.uid()');
    expect(migration).toContain('h.price_updated_at <= u.price_updated_at');
    expect(migration).not.toContain('quantity =');
    expect(migration).not.toContain('avg_cost =');
  });

  it('unrealized P/L migration stores P/L with market marks', () => {
    const migration = read('supabase/migrations/20260804120000_holdings_unrealized_pnl_persistence.sql');
    expect(migration).toContain('add column if not exists unrealized_pnl');
    expect(migration).toContain('unrealized_pnl = coalesce');
    expect(migration).toContain('update_holding_market_values');
  });

  it('Holding normalizes persisted price and timestamp after hydrate', () => {
    const context = read('context/DataContext.tsx');
    expect(context).toContain('row.current_price ?? row.currentPrice');
    expect(context).toContain('row.price_updated_at ?? row.priceUpdatedAt');
    expect(context).toContain('row.unrealized_pnl ?? row.unrealizedPnL');
    // Portfolio hydrate path uses normalizeHolding (not only insert select).
    const hydrateNormStart = context.indexOf('const normalizeHolding = (holding: any): Holding =>');
    expect(hydrateNormStart).toBeGreaterThan(-1);
    const hydrateNorm = context.slice(hydrateNormStart, context.indexOf('const normalizeInvestmentTransaction', hydrateNormStart));
    expect(hydrateNorm).toContain('holding.currentPrice ?? holding.current_price');
    expect(hydrateNorm).toContain('holding.priceUpdatedAt ?? holding.price_updated_at');
    expect(hydrateNorm).toContain('holding.unrealizedPnL ?? holding.unrealized_pnl');
    const types = read('types.ts');
    expect(types).toContain('currentPrice?: number');
    expect(types).toContain('priceUpdatedAt?: string');
    expect(types).toContain('unrealizedPnL?: number');
  });

  it('migration is documented as safe and required', () => {
    expect(read('supabase/README_DB_MIGRATIONS.md')).toContain(
      '20260725120000_holdings_market_price_persistence.sql',
    );
    expect(read('supabase/README_DB_MIGRATIONS.md')).toContain(
      '20260804120000_holdings_unrealized_pnl_persistence.sql',
    );
  });

  it('an older quote with the same price still corrects value after a quantity change', () => {
    const context = read('context/DataContext.tsx');
    const start = context.indexOf('const batchUpdateHoldingValues = async');
    const block = context.slice(start, context.indexOf('const recordTrade = async', start));
    expect(block).toContain('const samePrice =');
    expect(block).toContain('if (!samePrice) continue;');
    expect(block).toContain('effectiveMs = stored.ms;');
    expect(block).toContain('priceUpdatedAt: new Date(effectiveMs).toISOString()');
  });

  it('a failed save does not cancel alerts or commodity marks in the same tick', () => {
    const simulator = read('components/MarketSimulator.tsx');
    const start = simulator.indexOf('await batchUpdateHoldingValues(holdingUpdatesFiltered)');
    expect(start).toBeGreaterThan(-1);
    expect(simulator.slice(start, start + 400)).toContain(
      "console.warn('Holding market value persist failed:'",
    );
    expect(simulator.indexOf('triggeredAlerts.length > 0')).toBeGreaterThan(start);
  });
});

describe('persisted holding price seeds the quote path', () => {
  const rowsWith = (entries: Record<string, { price: number; fetchedAt: number }>) => {
    const out: Record<string, CachedQuoteRow> = {};
    for (const [k, v] of Object.entries(entries)) {
      out[k] = { price: v.price, change: 0, changePercent: 0, fetchedAt: v.fetchedAt };
    }
    return out;
  };

  it('seeds prices on a device with no local quote cache', () => {
    const at = '2026-07-24T13:00:00.000Z';
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [portfolioWith([holding({ symbol: 'MSFT', currentPrice: 421.5, priceUpdatedAt: at })])],
      {},
    );
    expect(result.changed).toBe(true);
    expect(result.seededSymbols).toContain('MSFT');
    expect(result.rows.MSFT).toEqual({
      price: 421.5,
      change: 0,
      changePercent: 0,
      fetchedAt: Date.parse(at),
    });
  });

  it('never fabricates a day change for a seeded price', () => {
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [
        portfolioWith([
          holding({ symbol: 'NVDA', currentPrice: 120, priceUpdatedAt: '2026-07-24T10:00:00.000Z' }),
        ]),
      ],
      {},
    );
    expect(result.rows.NVDA?.change).toBe(0);
    expect(result.rows.NVDA?.changePercent).toBe(0);
  });

  it('newer database price wins over an older local cache row', () => {
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [
        portfolioWith([
          holding({ symbol: 'MSFT', currentPrice: 430, priceUpdatedAt: '2026-07-24T15:00:00.000Z' }),
        ]),
      ],
      rowsWith({ MSFT: { price: 400, fetchedAt: Date.parse('2026-07-24T09:00:00.000Z') } }),
    );
    expect(result.rows.MSFT?.price).toBe(430);
  });

  it('a fresher local quote is never downgraded to the stored price', () => {
    const local = rowsWith({ MSFT: { price: 433, fetchedAt: Date.parse('2026-07-24T18:00:00.000Z') } });
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [
        portfolioWith([
          holding({ symbol: 'MSFT', currentPrice: 430, priceUpdatedAt: '2026-07-24T15:00:00.000Z' }),
        ]),
      ],
      local,
    );
    expect(result.changed).toBe(false);
    expect(result.rows).toBe(local);
    expect(result.rows.MSFT?.price).toBe(433);
  });

  it('skips manual funds and holdings without a usable mark', () => {
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [
        portfolioWith([
          holding({
            symbol: 'FUNDX',
            holdingType: 'manual_fund',
            currentPrice: 12,
            priceUpdatedAt: '2026-07-24T15:00:00.000Z',
          }),
          holding({ symbol: 'TSLA', currentValue: 0, currentPrice: undefined, priceUpdatedAt: undefined }),
          holding({ symbol: 'AMD', currentPrice: 0, priceUpdatedAt: '2026-07-24T15:00:00.000Z', currentValue: 0 }),
        ]),
      ],
      {},
    );
    expect(result.changed).toBe(false);
    expect(result.seededSymbols).toEqual([]);
  });

  it('does not derive unit price from book currentValue (avoids FX double-apply)', () => {
    const result = buildQuoteCacheRowsFromPersistedHoldingPrices(
      [portfolioWith([holding({ symbol: 'MSFT', quantity: 10, currentValue: 4200, currentPrice: undefined })])],
      {},
    );
    expect(result.changed).toBe(false);
    expect(result.rows.MSFT).toBeUndefined();
  });

  it('seed helper returns merged rows for the restore path', () => {
    const result = seedQuoteCacheFromPersistedHoldingPrices(
      [
        portfolioWith([
          holding({ symbol: 'AAPL', currentPrice: 210, priceUpdatedAt: '2026-07-24T15:00:00.000Z' }),
        ]),
      ],
      {},
    );
    expect(result.rows.AAPL?.price).toBe(210);
  });

  it('hydrate restore seeds from persisted prices before reading the cache', () => {
    const simulator = read('components/MarketSimulator.tsx');
    expect(simulator).toContain(
      'const seed = seedQuoteCacheFromPersistedHoldingPrices(getPersonalInvestments(data))',
    );
    expect(simulator).toContain('computeRestoreCachedQuotesPatch(data, sarPerUsd, seed.rows)');
    expect(simulator).toContain('sessionTimestampsForTrackedSymbols(tracked, seed.rows)');
  });
});
