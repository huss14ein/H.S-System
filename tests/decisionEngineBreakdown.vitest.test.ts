import { describe, it, expect } from 'vitest';
import { buyScore, buyScoreBreakdown } from '../services/decisionEngine';

describe('buyScoreBreakdown', () => {
  it('matches legacy buyScore output', () => {
    const inputs = [
      {},
      { emergencyFundMonths: 6, runwayMonths: 6, maxPositionPct: 20, currentPositionPct: 10, driftFromTargetPct: 3 },
      { emergencyFundMonths: 0.5, runwayMonths: 4, maxPositionPct: 35, currentPositionPct: 36, driftFromTargetPct: 8 },
      { emergencyFundMonths: 4, runwayMonths: 4, maxPositionPct: 35, currentPositionPct: 19, driftFromTargetPct: 7 },
    ];
    for (const i of inputs) {
      expect(buyScoreBreakdown(i).total).toBe(buyScore(i));
    }
  });

  it('sums adjustments from neutral base consistently', () => {
    const b = buyScoreBreakdown({
      emergencyFundMonths: 6,
      runwayMonths: 6,
      maxPositionPct: 35,
      currentPositionPct: 10,
      driftFromTargetPct: 10,
    });
    expect(b.liquidityAdjust).toBe(15);
    expect(b.concentrationAdjust).toBe(0);
    expect(b.driftAdjust).toBe(10);
    expect(b.total).toBe(Math.max(0, Math.min(100, Math.round(50 + 15 + 0 + 10))));
  });
});
