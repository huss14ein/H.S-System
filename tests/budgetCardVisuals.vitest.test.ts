import { describe, it, expect } from 'vitest';
import {
  budgetProgressGradient,
  budgetTierTopHairline,
  budgetUtilizationBadgeClasses,
} from '../services/budgetCardVisuals';

describe('budgetCardVisuals', () => {
  it('returns solid status classes (no heavy multi-stop gradients)', () => {
    expect(budgetProgressGradient('Healthy')).toMatch(/^bg-/);
    expect(budgetProgressGradient('Healthy')).not.toContain('via-');
    expect(budgetProgressGradient('Watch')).toBe('bg-amber-500');
    expect(budgetProgressGradient('Critical')).toBe('bg-rose-500');
    expect(budgetTierTopHairline('Healthy')).toContain('from-');
    expect(budgetUtilizationBadgeClasses('Healthy')).toContain('emerald');
  });
});
