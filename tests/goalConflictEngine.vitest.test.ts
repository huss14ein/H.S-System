import { describe, expect, it } from 'vitest';
import { detectGoalConflict, goalFeasibilityCheck } from '../services/goalConflictEngine';
import { buildGoalFundingScheduleRows } from '../services/goalFundingRouter';
import type { FinancialData, Goal } from '../types';

describe('detectGoalConflict', () => {
  it('sums required monthly from the same schedule as buildGoalFundingScheduleRows when data is passed', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 3);
    const iso = future.toISOString().slice(0, 10);
    const goals: Goal[] = [
      { id: 'a', name: 'A', targetAmount: 120_000, currentAmount: 0, deadline: iso, priority: 'High' } as Goal,
      { id: 'b', name: 'B', targetAmount: 60_000, currentAmount: 0, deadline: iso, priority: 'Medium' } as Goal,
    ];
    const data = {
      goals,
      accounts: [],
      transactions: [],
      investments: [],
      assets: [],
      liabilities: [],
    } as unknown as FinancialData;
    const rows = buildGoalFundingScheduleRows(data, 3.75);
    const expectedSum = rows.filter((r) => r.requiredPerMonth > 0).reduce((s, r) => s + r.requiredPerMonth, 0);
    const conflicts = detectGoalConflict({
      goals,
      monthlySurplusForGoals: 1,
      data,
      sarPerUsdUi: 3.75,
    });
    const same = conflicts.find((c) => c.reason === 'same_cash_source');
    expect(same?.requiredMonthlyTotal).toBeCloseTo(expectedSum, 5);
  });
});

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
