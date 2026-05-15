import { describe, expect, it } from 'vitest';
import { buildBudgetCardVisualMetrics } from '../services/budgetCardMetrics';

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
});
