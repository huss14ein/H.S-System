import { describe, expect, it } from 'vitest';
import { computeGoalMonthlyAllocation } from '../services/goalAllocation';

describe('computeGoalMonthlyAllocation', () => {
  it('returns allocation amount from monthly savings and percent', () => {
    expect(computeGoalMonthlyAllocation(10000, 25)).toBe(2500);
  });

  it('clamps percent to 0..100 for dynamic input changes', () => {
    expect(computeGoalMonthlyAllocation(10000, -10)).toBe(0);
    expect(computeGoalMonthlyAllocation(10000, 150)).toBe(10000);
  });

  it('handles invalid values safely for automated calculations', () => {
    expect(computeGoalMonthlyAllocation(Number.NaN, 40)).toBe(0);
    expect(computeGoalMonthlyAllocation(10000, Number.NaN)).toBe(0);
  });
});

