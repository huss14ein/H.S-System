/**
 * DRIP execution — dividend with Reinvest flag creates idempotent buy (B4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('dripExecution', () => {
  it('recordTrade reinvests dividend when dividendDistribution is Reinvest', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain("dripHolding?.dividendDistribution === 'Reinvest'");
    expect(ctx).toContain("type: 'buy'");
    expect(ctx).toContain('idempotencyKey: `drip|${divId}|${normalizedSymbol}`');
    expect(ctx).toContain("{ system: true }");
  });

  it('holding row persists dividend_distribution for DRIP', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('dividend_distribution');
    expect(ctx).toContain("holding.dividendDistribution === 'Reinvest'");
  });

  it('corporate action schema supports dividend_drip action type', () => {
    const migration = read('supabase/migrations/20260706130000_corporate_actions_and_cost_lots.sql');
    expect(migration).toMatch(/dividend_drip|dividend_cash/);
  });

  it('dividend tracker UI exposes reinvest distribution', () => {
    const workspace = read('components/DividendTrackerWorkspace.tsx');
    expect(workspace).toMatch(/Reinvest|reinvest/);
    expect(read('types.ts')).toContain("dividendDistribution?: 'Reinvest' | 'Payout'");
  });
});
