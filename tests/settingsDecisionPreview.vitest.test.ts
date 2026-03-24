import { describe, expect, it } from 'vitest';
import { computeMaxAbsSleeveDriftPercent } from '../services/settingsDecisionPreview';

describe('settingsDecisionPreview', () => {
  it('returns null for null data', () => {
    expect(computeMaxAbsSleeveDriftPercent(null)).toBeNull();
  });

  it('returns null when there are no holdings', () => {
    expect(
      computeMaxAbsSleeveDriftPercent({
        investments: [],
      } as any)
    ).toBeNull();
  });

  it('computes sleeve drift when a single core holding dominates vs default targets', () => {
    const data: any = {
      settings: { driftThreshold: 5 },
      investments: [
        {
          holdings: [{ symbol: 'AAPL', quantity: 10, avgCost: 100, currentValue: 10000 }],
        },
      ],
      investmentPlan: null,
      wealthUltraConfig: null,
      portfolioUniverse: [],
    };
    const d = computeMaxAbsSleeveDriftPercent(data);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(5);
  });
});
