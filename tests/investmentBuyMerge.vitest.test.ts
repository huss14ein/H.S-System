import { describe, it, expect } from 'vitest';
import { applyBuyToHolding, applySellToHolding, consolidateHoldingsBySymbol } from '../services/holdingMath';

describe('investment buy into existing holding', () => {
  it('computes weighted average cost', () => {
    const r = applyBuyToHolding({ quantity: 10, avgCost: 100, currentValue: 1000 }, 10, 140);
    expect(r.quantity).toBe(20);
    expect(r.avgCost).toBe(120);
    expect(r.currentValue).toBe(2400);
  });

  it('handles first lot avg when prior qty was zero', () => {
    const r = applyBuyToHolding({ quantity: 0, avgCost: 999, currentValue: 0 }, 5, 20);
    expect(r.quantity).toBe(5);
    expect(r.avgCost).toBe(20);
    expect(r.currentValue).toBe(100);
  });

  it('statement restates the plan total instead of adding the monthly contribution', () => {
    const r = applyBuyToHolding(
      { quantity: 1, avgCost: 10000, currentValue: 10000 },
      1,
      500,
      { currentValueOverride: 10800 },
    );
    expect(r.quantity).toBe(2);
    expect(r.avgCost).toBe(5250);
    expect(r.currentValue).toBe(10800);
  });

  it('blank statement adds this contribution to the stored plan value', () => {
    const r = applyBuyToHolding({ quantity: 1, avgCost: 10000, currentValue: 10000 }, 1, 500);
    expect(r.quantity).toBe(2);
    expect(r.avgCost).toBe(5250);
    expect(r.currentValue).toBe(10500);
  });
});

describe('duplicate symbol consolidation', () => {
  it('merges quantities/cost/currentValue/realizedPnL into primary row', () => {
    const merged = consolidateHoldingsBySymbol([
      {
        id: 'h1',
        symbol: 'AAPL',
        quantity: 2,
        avgCost: 100,
        currentValue: 220,
        realizedPnL: 5,
        zakahClass: 'Zakatable',
      },
      {
        id: 'h2',
        symbol: 'AAPL',
        quantity: 3,
        avgCost: 120,
        currentValue: 360,
        realizedPnL: 7,
        zakahClass: 'Zakatable',
      },
    ]);
    expect(merged?.id).toBe('h1');
    expect(merged?.quantity).toBe(5);
    expect(merged?.avgCost).toBe(112);
    expect(merged?.currentValue).toBe(580);
    expect(merged?.realizedPnL).toBe(12);
  });
});

describe('applySellToHolding', () => {
  it('reduces qty and scales currentValue', () => {
    const r = applySellToHolding({ quantity: 20, avgCost: 10, currentValue: 300 }, 5);
    expect(r.quantity).toBe(15);
    expect(r.avgCost).toBe(10);
    expect(r.currentValue).toBe(225);
    expect(r.closed).toBe(false);
  });
});
