import { describe, expect, it } from 'vitest';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import type { Holding } from '../types';

describe('effectiveHoldingValueInBookCurrency outlier clamp', () => {
  it('falls back to cost when stored current_value is absurd vs cost basis', () => {
    const h: Holding = {
      id: 'h1',
      symbol: '2222',
      name: 'Test',
      quantity: 100,
      avgCost: 10,
      currentValue: 5_000_000,
      holdingType: 'manual_fund',
    };
    const v = effectiveHoldingValueInBookCurrency(h, 'SAR', {}, 3.75);
    expect(v).toBe(1000);
  });
});
