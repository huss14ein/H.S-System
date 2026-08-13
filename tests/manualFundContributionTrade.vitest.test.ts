/**
 * Monthly retirement-plan contributions + manual marks.
 * Trace: Record Trade → applyPositionDeltaForTrade → holdingToRow current_price.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPositionDeltaForTrade } from '../services/applyPositionDeltaForTrade';
import { computePositionFieldsAfterTrade } from '../services/holdingMath';
import type { Holding } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function manualPlan(over: Partial<Holding> = {}): Holding {
  return {
    id: 'h-retire',
    symbol: 'RETIRE1',
    name: 'Bank retirement plan',
    quantity: 1,
    avgCost: 10000,
    currentValue: 10000,
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    holdingType: 'manual_fund',
    ...over,
  };
}

describe('manual fund monthly contribution math', () => {
  it('first buy uses statement as current value when provided', () => {
    const r = computePositionFieldsAfterTrade({
      existing: null,
      side: 'buy',
      quantity: 1,
      price: 500,
      opts: { currentValueOverride: 12500 },
    });
    expect(r.action).toBe('create');
    expect(r.quantity).toBe(1);
    expect(r.avgCost).toBe(500);
    expect(r.currentValue).toBe(12500);
  });

  it('first buy without statement uses amount invested', () => {
    const r = computePositionFieldsAfterTrade({
      existing: null,
      side: 'buy',
      quantity: 1,
      price: 500,
    });
    expect(r.currentValue).toBe(500);
    expect(r.avgCost).toBe(500);
  });

  it('subsequent buy with statement restates total (does not add 500 onto 10k then store 500)', async () => {
    const holdings: Holding[] = [manualPlan()];
    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'RETIRE1',
      side: 'buy',
      quantity: 1,
      price: 500,
      existingHolding: holdings[0],
      holdingType: 'manual_fund',
      manualCurrentValue: 10800,
      updateHolding,
      addHolding: async () => {
        throw new Error('must update existing plan, not create a duplicate');
      },
      deleteHolding: async () => {},
    });
    expect(holdings[0].quantity).toBe(2);
    expect(holdings[0].avgCost).toBe(5250);
    expect(holdings[0].currentValue).toBe(10800);
    expect(holdings[0].currentPrice).toBe(5400);
  });

  it('subsequent buy with blank statement adds this month to stored value', async () => {
    const holdings: Holding[] = [manualPlan()];
    const updateHolding = vi.fn(async (h: Holding) => {
      const i = holdings.findIndex((x) => x.id === h.id);
      if (i >= 0) holdings[i] = h;
    });
    await applyPositionDeltaForTrade({
      portfolioId: 'pf1',
      symbol: 'RETIRE1',
      side: 'buy',
      quantity: 1,
      price: 500,
      existingHolding: holdings[0],
      holdingType: 'manual_fund',
      updateHolding,
      addHolding: async () => {
        throw new Error('must update existing plan, not create a duplicate');
      },
      deleteHolding: async () => {},
    });
    expect(holdings[0].quantity).toBe(2);
    expect(holdings[0].currentValue).toBe(10500);
    expect(holdings[0].currentPrice).toBe(5250);
  });

  it('does not pass statement as currentValueAdd (would double-count then overwrite)', () => {
    const src = read('services/applyPositionDeltaForTrade.ts');
    expect(src).toContain('currentValueOverride: statementValue');
    expect(src).not.toMatch(/currentValueAdd:\s*args\.manualCurrentValue/);
    expect(src).not.toMatch(/\? args\.manualCurrentValue\s*: computed\.currentValue/);
  });
});

describe('manual fund Record Trade + persist wiring', () => {
  it('Record Trade uses contribution amount and optional statement total', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('Amount invested this month');
    expect(page).toContain('Latest statement / plan value (total, optional)');
    expect(page).toContain('Add to existing holding (optional)');
    expect(page).toContain('Pick the same retirement plan or fund for each monthly contribution');
    expect(page).not.toContain('Current value for this purchase (optional)');
    expect(page).not.toContain('Units (use 1 for a single plan/account)');
    expect(page).toContain('useContributionEntry');
    expect(page).toContain('buy-existing-holding-select');
    expect(page).toContain('contributionAmt');
    expect(page).toMatch(/useContributionEntry && Number\.isFinite\(contributionAmt\)/);
  });

  it('holdingToRow persists unit mark for manual funds so statement value survives hydrate', () => {
    const ctx = read('context/DataContext.tsx');
    const start = ctx.indexOf('function holdingToRow');
    const end = ctx.indexOf('function normalizeHoldingFromRow', start);
    const block = ctx.slice(start, end);
    expect(block).toContain("holdingType === 'manual_fund'");
    expect(block).toContain('row.current_price');
    expect(block).toContain('row.price_updated_at');
  });

  it('HoldingEdit stamps currentPrice from manual market total', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('roundAvgCostPerUnit(currentValue / qtyForMark)');
    expect(page).toContain('priceUpdatedAt: new Date().toISOString()');
  });
});
