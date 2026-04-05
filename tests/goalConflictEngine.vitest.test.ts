import { describe, expect, it } from 'vitest';
import { goalFeasibilityCheck } from '../services/goalConflictEngine';

describe('goalFeasibilityCheck', () => {
  const baseGoal = {
    id: 'g1',
    name: 'Goal 1',
    targetAmount: 12000,
    currentAmount: 0,
  } as any;

  it('returns no_deadline instead of sentinel months when deadline is missing', () => {
    const result = goalFeasibilityCheck({
      goal: baseGoal,
      monthlyContribution: 500,
      fromDate: new Date('2026-01-01'),
    });
    expect(result.feasible).toBe(false);
    expect(result.reason).toBe('no_deadline');
    expect(result.monthsNeeded).toBeNull();
    expect(result.monthsAvailable).toBeNull();
  });

  it('returns no_contribution when monthly contribution is zero', () => {
    const result = goalFeasibilityCheck({
      goal: { ...baseGoal, deadline: '2026-12-31' },
      monthlyContribution: 0,
      fromDate: new Date('2026-01-01'),
    });
    expect(result.feasible).toBe(false);
    expect(result.reason).toBe('no_contribution');
    expect(result.monthsNeeded).toBeNull();
    expect(result.monthsAvailable).toBeGreaterThanOrEqual(0);
  });

  it('returns timeline feasibility with numeric months when contribution exists', () => {
    const result = goalFeasibilityCheck({
      goal: { ...baseGoal, targetAmount: 6000, deadline: '2026-12-31' },
      monthlyContribution: 1000,
      fromDate: new Date('2026-01-01'),
    });
    expect(result.reason).toBe('timeline');
    expect(result.monthsNeeded).toBe(6);
    expect(result.monthsAvailable).toBeGreaterThanOrEqual(11);
  });
});
