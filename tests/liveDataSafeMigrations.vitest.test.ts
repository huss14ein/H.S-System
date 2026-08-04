/**
 * The production database holds real portfolios, holdings, and trades that cannot be rebuilt.
 * Every investment migration the app requires must therefore be additive: no table drop/recreate,
 * no truncate, no column removal, and no unscoped row delete.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Executable SQL only — comments describe safety and would false-positive the checks below. */
const sqlBody = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .toLowerCase();

/** Migrations the app requires for the investment/holdings feature set. */
const REQUIRED_INVESTMENT_MIGRATIONS = [
  '20260715120000_investment_transactions_portfolio_id.sql',
  '20260715121000_investment_transactions_fee_vat_types.sql',
  '20260715122000_backfill_investment_transactions_portfolio_id.sql',
  '20260722120000_holdings_unique_per_portfolio_symbol.sql',
  '20260725120000_holdings_market_price_persistence.sql',
  '20260802120000_market_quote_cache.sql',
  '20260804120000_holdings_unrealized_pnl_persistence.sql',
  '20260726120000_reconciliation_adjustment_engine.sql',
  '20260726140000_corporate_action_stock_dividend.sql',
];

const DEDUPE_MIGRATION = '20260722120000_holdings_unique_per_portfolio_symbol.sql';

describe('required investment migrations are safe on live data', () => {
  for (const file of REQUIRED_INVESTMENT_MIGRATIONS) {
    it(`${file} never drops, truncates, or rebuilds a table`, () => {
      const sql = sqlBody(`supabase/migrations/${file}`);
      expect(sql).not.toMatch(/drop\s+table/);
      expect(sql).not.toMatch(/truncate/);
      expect(sql).not.toMatch(/drop\s+column/);
      expect(sql).not.toMatch(/create\s+or\s+replace\s+table/);
    });
  }

  it('only the dedupe migration deletes rows, and only duplicate holdings', () => {
    for (const file of REQUIRED_INVESTMENT_MIGRATIONS) {
      if (file === DEDUPE_MIGRATION) continue;
      expect(sqlBody(`supabase/migrations/${file}`)).not.toMatch(/delete\s+from/);
    }
    const dedupe = sqlBody(`supabase/migrations/${DEDUPE_MIGRATION}`);
    // Scoped to extra rows of the same (user, portfolio, symbol) group — never a whole symbol.
    expect(dedupe).toContain('and r.rn > 1');
  });

  it('dedupe archives every removed holding before deleting it', () => {
    const dedupe = read(`supabase/migrations/${DEDUPE_MIGRATION}`);
    expect(dedupe).toContain('create table if not exists public.holdings_dedupe_backup');
    expect(dedupe).toContain('RETURNING h.*');
    expect(dedupe).toContain('INSERT INTO public.holdings_dedupe_backup');
    // Archive is user data: must not be readable by other accounts.
    expect(dedupe).toContain('enable row level security');
    expect(dedupe).toContain('auth.uid() = user_id');
  });

  it('dedupe is re-runnable (idempotent table, policy, and index)', () => {
    const dedupe = read(`supabase/migrations/${DEDUPE_MIGRATION}`);
    expect(dedupe).toContain('create table if not exists');
    expect(dedupe).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(dedupe).toContain('from pg_policies');
  });

  it('market-price migration only adds nullable columns and a scoped RPC', () => {
    const sql = read('supabase/migrations/20260725120000_holdings_market_price_persistence.sql');
    expect(sql).toContain('add column if not exists current_price numeric null');
    expect(sql).toContain('add column if not exists price_updated_at timestamptz null');
    expect(sql).toContain('h.user_id = auth.uid()');
  });

  it('market_quote_cache migration is additive with latest-wins upsert', () => {
    const sql = read('supabase/migrations/20260802120000_market_quote_cache.sql');
    expect(sql).toContain('create table if not exists public.market_quote_cache');
    expect(sql).toContain('upsert_market_quote_cache');
    expect(sql).toContain('c.fetched_at <= excluded.fetched_at');
  });

  it('the destructive rebuild script is documented as never required for live data', () => {
    const rebuild = read('supabase/rebuild_investments_tables_from_scratch.sql');
    expect(rebuild).toContain('DO NOT run on production with live data');
    const readme = read('supabase/README_DB_MIGRATIONS.md');
    expect(readme).toContain('Live data: never rebuild investment tables');
    expect(readme).toContain('holdings_dedupe_backup');
    expect(readme).toContain('additive migration');
  });
});
