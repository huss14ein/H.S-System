import { describe, expect, it } from 'vitest';
import type { FinancialData, Goal } from '../types';
import { computeGoalFundingPlan, GOAL_NO_DEADLINE_AMORTIZATION_MONTHS } from '../services/goalFundingRouter';
import { computeWindfallAllocationPct } from '../services/windfallAllocation';

describe('computeWindfallAllocationPct', () => {
  it('always allocates 100% across emergency, goals, and investing', () => {
    const r = computeWindfallAllocationPct({
      emergencyRunwayMonths: 3,
      weightedGoalGapSum: 50_000,
      annualSurplusAnchorSar: 120_000,
    });
    expect(r.emergencyPct + r.goalsPct + r.investPct).toBe(100);
  });

  it('sends all non-emergency slice to investing when there is no goal gap', () => {
    const r = computeWindfallAllocationPct({
      emergencyRunwayMonths: 8,
      weightedGoalGapSum: 0,
      annualSurplusAnchorSar: 80_000,
    });
    expect(r.goalsPct).toBe(0);
    expect(r.emergencyPct + r.investPct).toBe(100);
  });
});

describe('computeGoalFundingPlan', () => {
  const baseGoal = (g: Partial<Goal> & Pick<Goal, 'id' | 'name' | 'targetAmount' | 'deadline'>): Goal =>
    ({
      currentAmount: 0,
      priority: 'Medium',
      ...g,
    }) as Goal;

  it('treats overdue goals as catch-up lump sum, not inflated /mo', () => {
    const past = '2020-01-01';
    const data = {
      goals: [
        baseGoal({
          id: 'g1',
          name: 'Late',
          targetAmount: 120_000,
          deadline: past,
        }),
      ],
      accounts: [],
      transactions: [],
      investments: [],
      assets: [],
      liabilities: [],
    } as unknown as FinancialData;

    const plan = computeGoalFundingPlan(data, 120_000, 3.75);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]?.overdueCatchUpSar).toBe(120_000);
    expect(plan.suggestions[0]?.requiredPerMonth).toBe(0);
  });

  it('amortizes goals without deadline over fixed months', () => {
    const data = {
      goals: [baseGoal({ id: 'g2', name: 'Open', targetAmount: 60_000, deadline: '' })],
      accounts: [],
      transactions: [],
      investments: [],
      assets: [],
      liabilities: [],
    } as unknown as FinancialData;

    const plan = computeGoalFundingPlan(data, 120_000, 3.75);
    const s = plan.suggestions[0];
    expect(s?.requiredPerMonth).toBeCloseTo(60_000 / GOAL_NO_DEADLINE_AMORTIZATION_MONTHS, 5);
    expect(s?.overdueCatchUpSar).toBeUndefined();
  });

  it('priorityShare among on-track goals sums to 1 when surplus covers all required', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const iso = future.toISOString().slice(0, 10);
    const data = {
      goals: [
        baseGoal({ id: 'a', name: 'A', targetAmount: 24_000, deadline: iso, priority: 'High' }),
        baseGoal({ id: 'b', name: 'B', targetAmount: 12_000, deadline: iso, priority: 'Medium' }),
      ],
      accounts: [],
      transactions: [],
      investments: [],
      assets: [],
      liabilities: [],
    } as unknown as FinancialData;

    const annual = 120_000;
    const plan = computeGoalFundingPlan(data, annual, 3.75);
    const sumShare = plan.suggestions.reduce((s, x) => s + (x.priorityShare ?? 0), 0);
    expect(sumShare).toBeCloseTo(1, 5);
  });
});
