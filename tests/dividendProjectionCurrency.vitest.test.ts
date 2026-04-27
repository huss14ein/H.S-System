import { describe, expect, it } from 'vitest';
import { toSAR } from '../utils/currencyMath';

/** Regression: Finnhub dividend-per-share is listing currency (usually USD); must not use portfolio book currency for that leg. */
describe('dividend projection currency', () => {
  it('USD annual dividend × qty converts to SAR', () => {
    const sarPerUsd = 3.75;
    const annualUsd = 5 * 100; // e.g. $5/sh × 100 sh
    expect(toSAR(annualUsd, 'USD', sarPerUsd)).toBeCloseTo(1875, 8);
  });

  it('SAR-listed dividend stays in SAR (no FX multiply)', () => {
    const sarPerUsd = 3.75;
    const annualSar = 9400;
    expect(toSAR(annualSar, 'SAR', sarPerUsd)).toBeCloseTo(9400, 8);
  });
});
