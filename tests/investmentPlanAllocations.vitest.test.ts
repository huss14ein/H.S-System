import { describe, it, expect } from 'vitest';
import { normalizeSleeveFraction, normalizeCoreUpsideAllocations } from '../utils/investmentPlanAllocations';

describe('investmentPlanAllocations (DB percent vs fraction)', () => {
  it('normalizes whole percent to fraction', () => {
    expect(normalizeSleeveFraction(70, 0.7)).toBeCloseTo(0.7, 5);
    expect(normalizeSleeveFraction(30, 0.3)).toBeCloseTo(0.3, 5);
  });

  it('keeps 0–1 fractions', () => {
    expect(normalizeSleeveFraction(0.65, 0.7)).toBeCloseTo(0.65, 5);
  });

  it('normalizes core/upside when stored as percents', () => {
    const { core, upside } = normalizeCoreUpsideAllocations(70, 30, { core: 0.7, upside: 0.3 });
    expect(core + upside).toBeCloseTo(1, 2);
    expect(core).toBeCloseTo(0.7, 2);
    expect(upside).toBeCloseTo(0.3, 2);
  });
});
