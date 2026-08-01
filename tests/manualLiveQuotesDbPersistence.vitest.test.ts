/**
 * Manual-only live quotes + DB market_quote_cache persistence (E2E wiring).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMarketQuoteUpsertRows,
  mergeMarketQuoteCacheRowsFromDb,
} from '../services/marketQuoteDbCache';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const LIVE_API_CALLERS_ALLOWLIST = new Set([
  'components/MarketSimulator.tsx',
  'pages/Commodities.tsx',
  'pages/Assets.tsx',
  'pages/Zakat.tsx',
  'utils/commodityLiveValue.ts',
  'services/geminiService.ts',
  'services/finnhubService.ts',
  'services/sahmkQuote.ts',
  'services/quoteLiveFetchCoordinator.ts',
  'services/applyManualCommodityQuotes.ts',
  'services/marketQuoteDbCache.ts',
]);

describe('manualLiveQuotesDbPersistence', () => {
  it('MarketSimulator has no auto stale bootstrap or market-hours poll', () => {
    const sim = read('components/MarketSimulator.tsx');
    expect(sim).not.toContain('didScheduleStaleRefreshRef');
    expect(sim).not.toContain('MARKET_SESSION_POLL_MS');
    expect(sim).not.toContain('isAnyEquityMarketRegularSessionOpen');
    expect(sim).not.toContain('symbolsNeedingLiveFetch');
    expect(sim).not.toMatch(/\bsetInterval\s*\(/);
    expect(sim).toContain('seedQuoteCacheFromMarketQuoteDb');
    expect(sim).toContain('upsertMarketQuotesToDb');
    expect(sim).toContain('applyManualCommodityQuotes');
    expect(sim).toContain('await batchUpdateHoldingValues');
    expect(sim).toContain('batchUpdateCommodityHoldingValues');
    expect(sim).toContain('registerClearPendingLiveFetch');
    expect(sim).toContain('isQuoteRefreshCancelled()');
    // Holding notionals only from manual ticks — hydrate seeds session, not DB holdings.
    expect(sim).toContain('Holding notionals are updated only from manual live sync');
  });

  it('manual entry points still force-fetch; cancel clears pending overflow', () => {
    expect(read('components/Header.tsx')).toMatch(/refreshPrices\(\{ forceFetch: true \}\)/);
    expect(read('pages/Investments.tsx')).toContain('refreshPricesForPortfolio');
    expect(read('context/MarketDataContext.tsx')).toContain('scope.manual !== true');
    expect(read('context/MarketDataContext.tsx')).toContain('clearPendingLiveFetchSymbols');
    expect(read('context/MarketDataContext.tsx')).toContain('options?.forceFetch !== false');
    expect(read('utils/quoteRefreshBridge.ts')).toContain('clearPendingLiveFetchSymbols');
  });

  it('Commodities/Assets/Zakat persist manual prices into session + DB (canonical KPI SOT)', () => {
    expect(read('pages/Commodities.tsx')).toContain('applyManualCommodityQuotes');
    expect(read('pages/Assets.tsx')).toContain('applyManualCommodityQuotes');
    expect(read('pages/Zakat.tsx')).toContain('applyManualCommodityQuotes');
    expect(read('services/applyManualCommodityQuotes.ts')).toContain('persistCommodityQuotePrices');
    expect(read('services/applyManualCommodityQuotes.ts')).toContain('upsertMarketQuotesToDb');
    expect(read('services/applyManualCommodityQuotes.ts')).toContain('setSimulatedPrices');
    expect(read('utils/commodityLiveValue.ts')).toContain('unitPrice');
  });

  it('commodity add/edit persists quotes only after confirm + successful save', () => {
    for (const file of ['pages/Commodities.tsx', 'pages/Assets.tsx']) {
      const src = read(file);
      const confirmIdx = src.indexOf('const ok = await confirmAction(\n                summarizeCommodityForConfirm');
      expect(confirmIdx, `${file}: missing commodity confirm`).toBeGreaterThan(-1);
      const afterConfirm = src.slice(confirmIdx);
      expect(afterConfirm).toMatch(
        /if \(!ok\) return;[\s\S]{0,200}await onSave[\s\S]{0,200}applyManualCommodityQuotes/,
      );
      const beforeConfirm = src.slice(0, confirmIdx);
      const submitStart = beforeConfirm.lastIndexOf('const handleSubmit');
      const submitBlock = beforeConfirm.slice(submitStart);
      expect(submitBlock).not.toContain('applyManualCommodityQuotes');
    }
  });

  it('UNIFIED + README include market_quote_cache', () => {
    expect(read('supabase/UNIFIED_PRODUCTION_DB_SETUP.sql')).toContain('market_quote_cache');
    expect(read('supabase/UNIFIED_PRODUCTION_DB_SETUP.sql')).toContain('upsert_market_quote_cache');
    expect(read('supabase/README_DB_MIGRATIONS.md')).toContain('20260802120000_market_quote_cache.sql');
    expect(read('supabase/rls_all_user_tables.sql')).toContain('market_quote_cache');
  });

  it('migration adds market_quote_cache + upsert RPC (live-data safe)', () => {
    const sql = read('supabase/migrations/20260802120000_market_quote_cache.sql');
    expect(sql).toContain('create table if not exists public.market_quote_cache');
    expect(sql).toContain('upsert_market_quote_cache');
    expect(sql).toContain('auth.uid() = user_id');
    expect(sql.toLowerCase()).not.toMatch(/drop\s+table/);
    expect(sql.toLowerCase().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')).not.toMatch(/\btruncate\b/);
  });

  it('buildMarketQuoteUpsertRows dedupes by canonical symbol', () => {
    const rows = buildMarketQuoteUpsertRows(
      {
        aapl: { price: 190, change: 1, changePercent: 0.5 },
        AAPL: { price: 191, change: 2, changePercent: 1 },
      },
      1_700_000_000_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.symbol).toBe('AAPL');
    expect(rows[0]!.price).toBe(191);
  });

  it('mergeMarketQuoteCacheRowsFromDb prefers newer DB stamps', () => {
    const local = {
      AAPL: { price: 100, change: 0, changePercent: 0, fetchedAt: 1_000 },
    };
    const merged = mergeMarketQuoteCacheRowsFromDb(local, [
      { symbol: 'AAPL', price: 200, change: 1, change_percent: 0.5, fetched_at: new Date(2_000).toISOString() },
    ]);
    expect(merged.changed).toBe(true);
    expect(merged.rows.AAPL?.price).toBe(200);
    expect(merged.seededSymbols).toContain('AAPL');
  });

  it('no unexpected production files call getLivePricesDeduped / bumpPriceRefresh auto paths', () => {
    const root = process.cwd();
    const scanDirs = ['components', 'pages', 'hooks', 'context', 'utils'];
    const offenders: string[] = [];
    for (const dir of scanDirs) {
      const abs = join(root, dir);
      const walk = (d: string, prefix: string) => {
        for (const name of readdirSync(d, { withFileTypes: true })) {
          const rel = `${prefix}/${name.name}`;
          const full = join(d, name.name);
          if (name.isDirectory()) {
            walk(full, rel);
            continue;
          }
          if (!/\.(tsx|ts)$/.test(name.name)) continue;
          const src = readFileSync(full, 'utf8');
          if (!src.includes('getLivePricesDeduped') && !src.includes('bumpPriceRefresh(')) continue;
          if (LIVE_API_CALLERS_ALLOWLIST.has(rel.replace(/^\//, '')) || LIVE_API_CALLERS_ALLOWLIST.has(rel.slice(1))) {
            continue;
          }
          // MarketSimulator + MarketDataContext are expected
          if (rel.includes('MarketSimulator') || rel.includes('MarketDataContext')) continue;
          offenders.push(rel);
        }
      };
      walk(abs, dir);
    }
    expect(offenders).toEqual([]);
  });
});
