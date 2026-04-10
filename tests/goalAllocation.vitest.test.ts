import { describe, expect, it } from 'vitest';
import { computeGoalMonthlyAllocation, normalizeGoalAllocationPercent } from '../services/goalAllocation';

describe('goalAllocation helpers', () => {
  it('coerces numeric strings before finite checks', () => {
    expect(normalizeGoalAllocationPercent('25')).toBe(25);
    expect(computeGoalMonthlyAllocation(2000, '25')).toBe(500);
  });

  it('clamps invalid/overflowing values safely', () => {
    expect(normalizeGoalAllocationPercent('abc')).toBe(0);
    expect(normalizeGoalAllocationPercent(150)).toBe(100);
    expect(computeGoalMonthlyAllocation(2000, Infinity)).toBe(0);
  });
});
