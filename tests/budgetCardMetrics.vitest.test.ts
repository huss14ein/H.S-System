import { describe, expect, it } from 'vitest';
import { annualEnvelopeForBudgetRow, buildBudgetCardVisualMetrics } from '../services/budgetCardMetrics';
import type { Budget } from '../types';

describe('buildBudgetCardVisualMetrics', () => {
    it('uses monthly spend for dial % in dual-envelope Monthly view', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Monthly',
            period: 'monthly',
            limit: 1752,
            spentPeriod: 336,
            spentYtd: 2088,
            annualEnvelopeLimit: 2752,
        });
        expect(m.showDualEnvelope).toBe(true);
        expect(Math.round(m.percentage)).toBe(19);
        expect(Math.round(m.annualPercentage ?? 0)).toBe(76);
        expect(m.utilizationLabel).toBe('Healthy');
        expect(m.secondaryBarValue).toBe(336);
        expect(m.secondaryBarMax).toBe(1752);
    });

    it('uses YTD for yearly-period rows in Monthly view', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Monthly',
            period: 'yearly',
            limit: 12000,
            spentPeriod: 500,
            spentYtd: 2000,
            annualEnvelopeLimit: 0,
        });
        expect(Math.round(m.percentage)).toBe(17);
        expect(m.showDualEnvelope).toBe(false);
    });

    it('Weekly view: dial vs stored monthly limit (not annual envelope)', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Weekly',
            period: 'monthly',
            limit: 1200,
            spentPeriod: 200,
            spentYtd: 200,
            annualEnvelopeLimit: 14400,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.monthlyLimit).toBe(1200);
        expect(m.percentage).toBeCloseTo((200 / 1200) * 100, 5);
    });

    it('Daily view: spent vs stored monthly limit when period is monthly', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Daily',
            period: 'monthly',
            limit: 3000,
            spentPeriod: 50,
            spentYtd: 50,
            annualEnvelopeLimit: 36000,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.percentage).toBeCloseTo((50 / 3000) * 100, 5);
    });

    it('Yearly view: compares spent to full-year limit', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Yearly',
            period: 'monthly',
            limit: 7200,
            spentPeriod: 4000,
            spentYtd: 4000,
            annualEnvelopeLimit: 0,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.primaryBarMax).toBe(7200);
        expect(Math.round(m.percentage)).toBe(Math.round((4000 / 7200) * 100));
    });
});

describe('annualEnvelopeForBudgetRow', () => {
    const b = (partial: Partial<Budget>): Budget =>
        ({
            id: 'x',
            user_id: 'u',
            category: 'Food',
            year: 2026,
            month: 4,
            limit: 100,
            period: 'monthly',
            tier: 'Optional',
            ...partial,
        }) as Budget;

    it('returns 0 for yearly-period rows (envelope N/A)', () => {
        expect(annualEnvelopeForBudgetRow('Food', 2026, [b({ period: 'yearly', limit: 12_000 })], 'yearly')).toBe(0);
    });
});
