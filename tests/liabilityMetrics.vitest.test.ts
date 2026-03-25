import { describe, expect, it } from 'vitest';
import { debtServiceRatio, liquidityRatio } from '../services/liabilityMetrics';

describe('liquidityRatio', () => {
  it('returns null when there is no debt (no fake divisor)', () => {
    expect(liquidityRatio(47700, 0)).toBeNull();
    expect(liquidityRatio(47700, -1)).toBeNull();
  });

  it('divides liquid cash by debt when debt is positive', () => {
    expect(liquidityRatio(10000, 2000)).toBeCloseTo(5);
    expect(liquidityRatio(0, 1000)).toBe(0);
  });
});

describe('debtServiceRatio', () => {
  it('returns 0 when annual payments are zero', () => {
    expect(debtServiceRatio(0, 5000)).toBe(0);
  });
});
