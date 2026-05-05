import { describe, it, expect } from 'vitest';
import { annualEnvelopeLimitForCategory, monthlyEquivalentStoredLimit } from '../services/budgetEnvelopeMath';
import type { Budget } from '../types';

const base = (over: Partial<Budget> & Pick<Budget, 'category' | 'year' | 'limit' | 'period'>): Budget =>
    ({
        id: 't',
        user_id: 'u',
        month: 1,
        ...over,
    }) as Budget;

describe('monthlyEquivalentStoredLimit', () => {
    it('normalizes weekly and daily to monthly SAR-style equivalent', () => {
        expect(monthlyEquivalentStoredLimit({ limit: 1200, period: 'yearly' })).toBe(100);
        expect(monthlyEquivalentStoredLimit({ limit: 100, period: 'weekly' })).toBeCloseTo(100 * (52 / 12), 5);
        expect(monthlyEquivalentStoredLimit({ limit: 10, period: 'daily' })).toBeCloseTo(10 * (365 / 12), 5);
        expect(monthlyEquivalentStoredLimit({ limit: 500, period: 'monthly' })).toBe(500);
    });
});

describe('annualEnvelopeLimitForCategory', () => {
    const cat = 'Food';
    const year = 2026;

    it('returns 0 when no rows', () => {
        expect(annualEnvelopeLimitForCategory(cat, year, [])).toBe(0);
    });

    it('uses max yearly limit when any yearly row exists (yearly dominates)', () => {
        const rows: Budget[] = [
            base({ category: cat, year, limit: 12_000, period: 'yearly' }),
            base({ category: cat, year, limit: 500, period: 'monthly' }),
        ];
        expect(annualEnvelopeLimitForCategory(cat, year, rows)).toBe(12_000);
    });

    it('sums monthly-equivalent limits when multiple non-yearly rows exist', () => {
        const rows: Budget[] = [
            base({ category: cat, year, limit: 300, period: 'monthly', month: 1 }),
            base({ category: cat, year, limit: 300, period: 'monthly', month: 2 }),
        ];
        expect(annualEnvelopeLimitForCategory(cat, year, rows)).toBe(600);
    });

    it('extrapolates ×12 when exactly one monthly row exists', () => {
        const rows: Budget[] = [base({ category: cat, year, limit: 400, period: 'monthly' })];
        expect(annualEnvelopeLimitForCategory(cat, year, rows)).toBe(4800);
    });

    it('ignores other categories and years', () => {
        const rows: Budget[] = [
            base({ category: cat, year, limit: 100, period: 'monthly' }),
            base({ category: 'Other', year, limit: 9999, period: 'monthly' }),
            base({ category: cat, year: year - 1, limit: 9999, period: 'monthly' }),
        ];
        expect(annualEnvelopeLimitForCategory(cat, year, rows)).toBe(1200);
    });
});
