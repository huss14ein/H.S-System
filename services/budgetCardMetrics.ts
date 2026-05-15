import type { Budget } from '../types';
import { annualEnvelopeLimitForCategory, monthlyEquivalentStoredLimit } from './budgetEnvelopeMath';
import type { BudgetViewMode } from './budgetViewSpendWindows';

export type BudgetUtilizationLabel = 'Healthy' | 'Watch' | 'Critical';

export type BudgetCardVisualMetrics = {
    spent: number;
    spentYtd: number;
    annualEnvelopeLimit: number;
    primaryBarValue: number;
    primaryBarMax: number;
    secondaryBarValue?: number;
    secondaryBarMax?: number;
    /** Headline dial, health badge, and trend context — monthly in dual-envelope mode. */
    percentage: number;
    /** Annual envelope bar when `showDualEnvelope`. */
    annualPercentage?: number;
    utilizationLabel: BudgetUtilizationLabel;
    annualUtilizationLabel?: BudgetUtilizationLabel;
    colorClass: string;
    monthlyLimit: number;
    showDualEnvelope: boolean;
};

export function utilizationLabelFromPercentage(percentage: number): BudgetUtilizationLabel {
    const pct = Number.isFinite(percentage) ? percentage : 0;
    if (pct > 100) return 'Critical';
    if (pct > 90) return 'Watch';
    return 'Healthy';
}

export function colorClassFromUtilization(label: BudgetUtilizationLabel): string {
    if (label === 'Critical') return 'bg-danger';
    if (label === 'Watch') return 'bg-warning';
    return 'bg-primary';
}

function safePct(numerator: number, denominator: number): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
    return (numerator / denominator) * 100;
}

/**
 * Card dial + bars for Budgets (own, shared, admin overview).
 * In Monthly view with a monthly-period row and annual envelope: headline % is **this month**,
 * not YTD vs annual cap.
 */
export function buildBudgetCardVisualMetrics(args: {
    budgetView: BudgetViewMode;
    period: Budget['period'] | string | undefined;
    limit: number;
    spentPeriod: number;
    spentYtd: number;
    annualEnvelopeLimit: number;
}): BudgetCardVisualMetrics {
    const { budgetView, period, limit, spentPeriod, spentYtd, annualEnvelopeLimit } = args;
    const p = (period ?? 'monthly') as Budget['period'];
    const monthlyLimit = monthlyEquivalentStoredLimit({ limit, period: p });
    const showDualEnvelope =
        budgetView === 'Monthly' && p === 'monthly' && annualEnvelopeLimit > 0;

    if (budgetView === 'Monthly' && p === 'yearly') {
        const percentage = safePct(spentYtd, limit);
        const utilizationLabel = utilizationLabelFromPercentage(percentage);
        return {
            spent: spentPeriod,
            spentYtd,
            annualEnvelopeLimit: 0,
            primaryBarValue: spentYtd,
            primaryBarMax: limit > 0 ? limit : 1,
            percentage,
            utilizationLabel,
            colorClass: colorClassFromUtilization(utilizationLabel),
            monthlyLimit,
            showDualEnvelope: false,
        };
    }

    if (showDualEnvelope) {
        const percentage = safePct(spentPeriod, monthlyLimit);
        const annualPercentage = safePct(spentYtd, annualEnvelopeLimit);
        const utilizationLabel = utilizationLabelFromPercentage(percentage);
        const annualUtilizationLabel = utilizationLabelFromPercentage(annualPercentage);
        return {
            spent: spentPeriod,
            spentYtd,
            annualEnvelopeLimit,
            primaryBarValue: spentYtd,
            primaryBarMax: annualEnvelopeLimit,
            secondaryBarValue: spentPeriod,
            secondaryBarMax: monthlyLimit > 0 ? monthlyLimit : 1,
            percentage,
            annualPercentage,
            utilizationLabel,
            annualUtilizationLabel,
            colorClass: colorClassFromUtilization(utilizationLabel),
            monthlyLimit,
            showDualEnvelope: true,
        };
    }

    if (budgetView === 'Yearly') {
        const percentage = safePct(spentPeriod, limit);
        const utilizationLabel = utilizationLabelFromPercentage(percentage);
        return {
            spent: spentPeriod,
            spentYtd,
            annualEnvelopeLimit: 0,
            primaryBarValue: spentPeriod,
            primaryBarMax: limit > 0 ? limit : 1,
            percentage,
            utilizationLabel,
            colorClass: colorClassFromUtilization(utilizationLabel),
            monthlyLimit,
            showDualEnvelope: false,
        };
    }

    const percentage = safePct(spentPeriod, monthlyLimit);
    const utilizationLabel = utilizationLabelFromPercentage(percentage);
    return {
        spent: spentPeriod,
        spentYtd,
        annualEnvelopeLimit: annualEnvelopeLimit > 0 ? annualEnvelopeLimit : 0,
        primaryBarValue: spentPeriod,
        primaryBarMax: monthlyLimit > 0 ? monthlyLimit : 1,
        percentage,
        utilizationLabel,
        colorClass: colorClassFromUtilization(utilizationLabel),
        monthlyLimit,
        showDualEnvelope: false,
    };
}

export function annualEnvelopeForBudgetRow(
    category: string,
    year: number,
    budgets: Budget[],
    period: Budget['period'] | string | undefined,
): number {
    const p = period ?? 'monthly';
    if (p === 'yearly') return 0;
    return annualEnvelopeLimitForCategory(category, year, budgets);
}
