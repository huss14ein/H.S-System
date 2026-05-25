import type { Budget } from '../types';
import { annualEnvelopeLimitForCategory, monthlyEquivalentStoredLimit } from './budgetEnvelopeMath';
import type { BudgetViewMode } from './budgetViewSpendWindows';

const WEEKS_PER_MONTH = 52 / 12;
const DAYS_PER_MONTH = 365 / 12;

/**
 * Spend cap for the active Budgets view (weekly spend vs weekly cap, not monthly cap).
 */
export function spendingCapForBudgetView(
  budgetView: BudgetViewMode,
  period: Budget['period'] | string | undefined,
  storedLimit: number,
): number {
  const p = (period ?? 'monthly') as Budget['period'];
  const limit = Number(storedLimit) || 0;
  const monthly = monthlyEquivalentStoredLimit({ limit, period: p });

  switch (budgetView) {
    case 'Weekly':
      if (p === 'weekly') return limit;
      if (p === 'daily') return limit * 7;
      if (p === 'yearly') return limit / 52;
      return monthly / WEEKS_PER_MONTH;
    case 'Daily':
      if (p === 'daily') return limit;
      if (p === 'weekly') return limit / 7;
      if (p === 'yearly') return limit / 365;
      return monthly / DAYS_PER_MONTH;
    case 'Yearly':
      if (p === 'yearly') return limit;
      return monthly * 12;
    case 'Monthly':
    default:
      if (p === 'yearly') return limit;
      return monthly;
  }
}

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
    /** Cap for the active view window (matches dial % and single-period bars). */
    periodSpendCap: number;
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
    const periodSpendCap = spendingCapForBudgetView(budgetView, p, limit);
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
            periodSpendCap: limit > 0 ? limit : 1,
            showDualEnvelope: false,
        };
    }

    if (showDualEnvelope) {
        const monthCap = spendingCapForBudgetView('Monthly', p, limit);
        const percentage = safePct(spentPeriod, monthCap);
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
            secondaryBarMax: monthCap > 0 ? monthCap : 1,
            percentage,
            annualPercentage,
            utilizationLabel,
            annualUtilizationLabel,
            colorClass: colorClassFromUtilization(utilizationLabel),
            monthlyLimit,
            periodSpendCap: monthCap > 0 ? monthCap : 1,
            showDualEnvelope: true,
        };
    }

    if (budgetView === 'Yearly') {
        const yearCap = spendingCapForBudgetView('Yearly', p, limit);
        const percentage = safePct(spentPeriod, yearCap);
        const utilizationLabel = utilizationLabelFromPercentage(percentage);
        return {
            spent: spentPeriod,
            spentYtd,
            annualEnvelopeLimit: 0,
            primaryBarValue: spentPeriod,
            primaryBarMax: yearCap > 0 ? yearCap : 1,
            percentage,
            utilizationLabel,
            colorClass: colorClassFromUtilization(utilizationLabel),
            monthlyLimit,
            periodSpendCap: yearCap > 0 ? yearCap : 1,
            showDualEnvelope: false,
        };
    }

    const percentage = safePct(spentPeriod, periodSpendCap);
    const utilizationLabel = utilizationLabelFromPercentage(percentage);
    return {
        spent: spentPeriod,
        spentYtd,
        annualEnvelopeLimit: annualEnvelopeLimit > 0 ? annualEnvelopeLimit : 0,
        primaryBarValue: spentPeriod,
        primaryBarMax: periodSpendCap > 0 ? periodSpendCap : 1,
        percentage,
        utilizationLabel,
        colorClass: colorClassFromUtilization(utilizationLabel),
        monthlyLimit,
        periodSpendCap: periodSpendCap > 0 ? periodSpendCap : 1,
        showDualEnvelope: false,
    };
}

export function annualEnvelopeForBudgetRow(
  category: string,
  year: number,
  budgets: Budget[],
  period: Budget['period'] | string | undefined,
  monthStartDay: unknown = 1,
): number {
  const p = period ?? 'monthly';
  if (p === 'yearly') return 0;
  return annualEnvelopeLimitForCategory(category, year, budgets, monthStartDay);
}
