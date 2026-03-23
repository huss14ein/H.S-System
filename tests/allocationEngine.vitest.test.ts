import { describe, expect, it } from 'vitest';
import { computeSleeveAllocations } from '../wealth-ultra/allocationEngine';
import { getDefaultWealthUltraConfig } from '../wealth-ultra/config';
import type { WealthUltraPosition } from '../types';

describe('computeSleeveAllocations', () => {
  it('reports 0% drift when portfolio value is zero (no misleading gap vs targets)', () => {
    const config = getDefaultWealthUltraConfig();
    const positions: WealthUltraPosition[] = [];
    const allocations = computeSleeveAllocations(positions, config, 0);
    expect(allocations).toHaveLength(3);
    for (const a of allocations) {
      expect(a.driftPct).toBe(0);
      expect(a.allocationPct).toBe(0);
    }
  });

  it('computes drift when total portfolio value is positive', () => {
    const config = getDefaultWealthUltraConfig();
    const positions: WealthUltraPosition[] = [
      {
        ticker: 'AAA',
        sleeveType: 'Core',
        riskTier: 'Med',
        strategyMode: 'Hold',
        currentShares: 1,
        avgCost: 100,
        currentPrice: 100,
        marketValue: 10000,
        plDollar: 0,
        plPct: 0,
        applyTarget1: true,
        applyTarget2: false,
        applyTrailing: true,
      } as WealthUltraPosition,
    ];
    const total = 10000;
    const allocations = computeSleeveAllocations(positions, config, total);
    const core = allocations.find((x) => x.sleeve === 'Core');
    expect(core).toBeDefined();
    expect(core!.allocationPct).toBeCloseTo(100, 5);
    expect(Math.abs(core!.driftPct)).toBeGreaterThan(0);
  });
});
