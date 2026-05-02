import { describe, it, expect } from 'vitest';
import { budgetProgressGradient, budgetTierTopHairline, budgetCardOrbTop } from '../services/budgetCardVisuals';

describe('budgetCardVisuals', () => {
    it('returns non-empty tailwind class strings for all variants', () => {
        expect(budgetProgressGradient('Healthy')).toContain('gradient');
        expect(budgetProgressGradient('Watch')).toContain('gradient');
        expect(budgetProgressGradient('Critical')).toContain('gradient');
        expect(budgetTierTopHairline('Core')).toContain('from-');
        expect(budgetCardOrbTop('Healthy')).toContain('gradient');
    });
});
