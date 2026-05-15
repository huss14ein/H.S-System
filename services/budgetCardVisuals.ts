/** Tailwind class bundles for premium budget cards (see Budgets page). */

export type BudgetUtilizationLabel = 'Healthy' | 'Watch' | 'Critical';
export type BudgetTierVisual = 'Core' | 'Supporting' | 'Optional';

export function budgetCardOrbTop(util: BudgetUtilizationLabel): string {
    switch (util) {
        case 'Critical':
            return 'bg-gradient-to-br from-rose-400/40 via-orange-400/25 to-transparent';
        case 'Watch':
            return 'bg-gradient-to-br from-amber-400/40 via-yellow-300/20 to-transparent';
        default:
            return 'bg-gradient-to-br from-emerald-400/35 via-teal-400/25 to-transparent';
    }
}

export function budgetCardOrbBottom(util: BudgetUtilizationLabel): string {
    switch (util) {
        case 'Critical':
            return 'bg-gradient-to-tr from-rose-500/25 to-amber-400/15';
        case 'Watch':
            return 'bg-gradient-to-tr from-amber-400/25 to-orange-300/15';
        default:
            return 'bg-gradient-to-tr from-cyan-400/20 to-emerald-400/18';
    }
}

/** Thin top accent bar on each card (tier identity). */
export function budgetTierTopHairline(tier: BudgetTierVisual): string {
    switch (tier) {
        case 'Core':
            return 'from-indigo-600 via-violet-600 to-fuchsia-600';
        case 'Supporting':
            return 'from-sky-500 via-indigo-500 to-blue-700';
        default:
            return 'from-slate-500 via-slate-600 to-slate-800';
    }
}

/** Fill for primary utilization bars (matches dial + status). */
export function budgetProgressGradient(util: BudgetUtilizationLabel): string {
    switch (util) {
        case 'Critical':
            return 'bg-gradient-to-r from-rose-500 via-rose-600 to-orange-600';
        case 'Watch':
            return 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500';
        default:
            return 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600';
    }
}

/** Secondary bar (e.g. “this month”) — distinct from annual. */
export function budgetSecondaryProgressGradient(): string {
    return 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-600';
}

/** Left segment: amount consumed toward cap (warm / active spend). */
export function budgetConsumedSegmentGradient(util: BudgetUtilizationLabel): string {
    switch (util) {
        case 'Critical':
            return 'bg-gradient-to-r from-rose-600 via-red-600 to-orange-700';
        case 'Watch':
            return 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600';
        default:
            return 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600';
    }
}

/** “This month” block: consumed segment (keeps violet family, distinct from green remaining). */
export function budgetMonthlyConsumedSegmentGradient(): string {
    return 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600';
}

/** Right segment: remaining budget headroom (cool / safe). */
export function budgetRemainingSegmentClasses(): string {
    return 'bg-gradient-to-r from-emerald-200 via-teal-100 to-cyan-100 ring-1 ring-inset ring-emerald-300/40';
}

/** When over cap, remaining band collapses — full bar shows critical consumed. */
export function budgetOverBudgetConsumedGradient(): string {
    return 'bg-gradient-to-r from-rose-600 via-red-600 to-red-800';
}
