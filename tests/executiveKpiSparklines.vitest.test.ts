import { describe, it, expect } from 'vitest';
import {
  liquidCashSparklineFromSnapshots,
  netWorthSparklineFromSnapshots,
  twoPointTrend,
} from '../services/executiveKpiSparklines';

describe('executiveKpiSparklines', () => {
  it('twoPointTrend returns current when prior invalid', () => {
    expect(twoPointTrend(100, Number.NaN)).toEqual([100]);
    expect(twoPointTrend(100, 90)).toEqual([90, 100]);
  });

  it('snapshot helpers return arrays without throwing when storage empty', () => {
    expect(Array.isArray(netWorthSparklineFromSnapshots())).toBe(true);
    expect(Array.isArray(liquidCashSparklineFromSnapshots())).toBe(true);
  });
});
