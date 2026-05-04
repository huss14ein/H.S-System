import { describe, expect, it } from 'vitest';
import { computeGoalTimelineStatus } from '../services/goalMetrics';
import type { Goal } from '../types';

describe('computeGoalTimelineStatus', () => {
  const futureDeadline = (): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 3);
    return d.toISOString().slice(0, 10);
  };

  it('does not report On Track when envelope is zero but gap and time remain', () => {
    const goal: Goal = {
      id: 'g1',
      name: 'House',
      targetAmount: 500_000,
      deadline: futureDeadline(),
      currentAmount: 0,
      savingsAllocationPercent: 0,
    };
    const r = computeGoalTimelineStatus({
      goal,
      resolvedCurrentAmountSar: 100_000,
      projectedMonthlyContribution: 0,
    });
    expect(r.status).not.toBe('On Track');
    expect(r.status).toBe('Needs Attention');
  });

  it('reports On Track when envelope meets ≥80% of required pace', () => {
    const goal: Goal = {
      id: 'g2',
      name: 'Trip',
      targetAmount: 120_000,
      deadline: futureDeadline(),
      currentAmount: 0,
      savingsAllocationPercent: 10,
    };
    /** Requires ~3333/mo over ~36 months from now with small gap — tune numbers after computing monthsLeft */
    const r = computeGoalTimelineStatus({
      goal,
      resolvedCurrentAmountSar: 0,
      projectedMonthlyContribution: 50_000,
    });
    expect(r.status).toBe('On Track');
  });
});
