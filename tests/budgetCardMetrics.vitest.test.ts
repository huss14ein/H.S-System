import { describe, expect, it } from 'vitest';
import { dedupeBudgetRowsForFinancialView } from '../utils/financialMonth';
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
        expect(m.periodSpendCap).toBe(1752);
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

    it('Weekly view: dial % uses weekly cap for monthly-period budget', () => {
        const weeklyCap = 1200 / (52 / 12);
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Weekly',
            period: 'monthly',
            limit: 1200,
            spentPeriod: weeklyCap * 0.5,
            spentYtd: weeklyCap * 0.5,
            annualEnvelopeLimit: 14400,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.monthlyLimit).toBe(1200);
        expect(m.percentage).toBeCloseTo(50, 1);
        expect(m.periodSpendCap).toBeCloseTo(weeklyCap, 2);
    });

    it('Daily view: dial % uses daily cap for monthly-period budget', () => {
        const dailyCap = 3000 / (365 / 12);
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Daily',
            period: 'monthly',
            limit: 3000,
            spentPeriod: dailyCap,
            spentYtd: dailyCap,
            annualEnvelopeLimit: 36000,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.percentage).toBeCloseTo(100, 1);
        expect(m.periodSpendCap).toBeCloseTo(dailyCap, 2);
    });

    it('Yearly view: annualizes monthly-period stored limit for dial and bars', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Yearly',
            period: 'monthly',
            limit: 600,
            spentPeriod: 4000,
            spentYtd: 4000,
            annualEnvelopeLimit: 0,
        });
        expect(m.showDualEnvelope).toBe(false);
        expect(m.primaryBarMax).toBe(7200);
        expect(Math.round(m.percentage)).toBe(Math.round((4000 / 7200) * 100));
    });

    it('Yearly view: yearly-period limit is not multiplied again', () => {
        const m = buildBudgetCardVisualMetrics({
            budgetView: 'Yearly',
            period: 'yearly',
            limit: 7200,
            spentPeriod: 4000,
            spentYtd: 4000,
            annualEnvelopeLimit: 0,
        });
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

    it('sums all financial months in the year, not only the active view month', () => {
        const rows: Budget[] = [
            b({ id: 'm4', month: 4, limit: 300 }),
            b({ id: 'm5', month: 5, limit: 400 }),
        ];
        const viewKey = { year: 2026, month: 5 };
        const viewOnly = dedupeBudgetRowsForFinancialView(rows, viewKey, 1, 'Monthly');
        expect(viewOnly).toHaveLength(1);
        const envelopeFromViewFilter = annualEnvelopeForBudgetRow('Food', 2026, viewOnly, 'monthly', 1);
        const envelopeFromFullYear = annualEnvelopeForBudgetRow('Food', 2026, rows, 'monthly', 1);
        expect(envelopeFromFullYear).toBe(700);
        expect(envelopeFromViewFilter).not.toBe(envelopeFromFullYear);
    });
});
