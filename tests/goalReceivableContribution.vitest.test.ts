import { describe, expect, it } from 'vitest';
import { receivableContributionForGoal } from '../services/goalReceivableContribution';
import type { Liability } from '../types';

describe('receivableContributionForGoal', () => {
  it('counts active personal receivable linked to goal', () => {
    const l: Liability = {
      id: 'r1',
      name: 'Friend',
      type: 'Receivable',
      amount: 5000,
      status: 'Active',
      goalId: 'g1',
    };
    expect(receivableContributionForGoal(l, 'g1')).toBe(5000);
  });

  it('returns 0 when paid or wrong goal', () => {
    const paid: Liability = {
      id: 'r2',
      name: 'X',
      type: 'Receivable',
      amount: 100,
      status: 'Paid',
      goalId: 'g1',
    };
    expect(receivableContributionForGoal(paid, 'g1')).toBe(0);
    const wrongGoal: Liability = { ...paid, status: 'Active', goalId: 'g2' };
    expect(receivableContributionForGoal(wrongGoal, 'g1')).toBe(0);
  });

  it('returns 0 when owner set (managed wealth)', () => {
    const l: Liability = {
      id: 'r3',
      name: 'Father loan',
      type: 'Receivable',
      amount: 30000,
      status: 'Active',
      goalId: 'g1',
      owner: 'Father',
    };
    expect(receivableContributionForGoal(l, 'g1')).toBe(0);
  });
});
