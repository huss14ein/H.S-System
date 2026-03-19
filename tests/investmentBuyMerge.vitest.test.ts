import { describe, it, expect } from 'vitest';
import { applyBuyToHolding, consolidateHoldingsBySymbol } from '../services/holdingMath';

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
