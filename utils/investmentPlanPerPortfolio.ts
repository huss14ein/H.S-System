import type { InvestmentPlanSettings } from '../types';

export type PlanSlice = Omit<InvestmentPlanSettings, 'plansByPortfolioId'>;

/** Remove nested per-portfolio map before storing a slice inside `plansByPortfolioId`. */
export function stripNestedPlans(p: InvestmentPlanSettings): InvestmentPlanSettings {
    const { plansByPortfolioId: _nested, ...rest } = p;
    return rest as InvestmentPlanSettings;
}

/** Strip to a serializable per-portfolio slice (no nested map). */
export function toPlanSlice(p: InvestmentPlanSettings): PlanSlice {
    return stripNestedPlans(p) as PlanSlice;
}

const emptyPlans = {} as Record<string, PlanSlice>;

/** Effective plan for one investment portfolio; falls back to legacy root plan when no slice exists. */
export function getEffectivePlanForPortfolio(
    root: InvestmentPlanSettings,
    portfolioId: string | undefined | null,
    defaults: InvestmentPlanSettings,
): InvestmentPlanSettings {
    const base: InvestmentPlanSettings = {
        ...defaults,
        ...stripNestedPlans(root),
        plansByPortfolioId: root.plansByPortfolioId,
    };
    if (!portfolioId) return base;
    const slice = root.plansByPortfolioId?.[portfolioId];
    if (!slice) return base;
    return {
        ...base,
        ...slice,
        plansByPortfolioId: root.plansByPortfolioId,
    };
}

/** Normalize a partial plan JSON object from DB into a full slice (no nested plans). */
export function normalizePlanSlice(raw: Partial<PlanSlice> | null | undefined, defaults: InvestmentPlanSettings): PlanSlice {
    if (!raw || typeof raw !== 'object') return toPlanSlice(defaults);
    const merged = { ...defaults, ...raw } as InvestmentPlanSettings;
    return toPlanSlice(merged);
}

/** Sum monthly budgets across per-portfolio slices (and legacy root if no slices). */
export function aggregateMonthlyBudgetAcrossPortfolios(
    root: InvestmentPlanSettings,
    portfolioIds: string[],
    defaults: InvestmentPlanSettings,
): { total: number; planCurrency: InvestmentPlanSettings['budgetCurrency'] } {
    const cur = (root.budgetCurrency || defaults.budgetCurrency) as InvestmentPlanSettings['budgetCurrency'];
    const byP = root.plansByPortfolioId ?? emptyPlans;
    if (portfolioIds.length === 0) {
        const raw = Number(root.monthlyBudget ?? 0);
        return { total: Number.isFinite(raw) ? raw : 0, planCurrency: cur };
    }
    let sum = 0;
    let anySlice = false;
    for (const id of portfolioIds) {
        const s = byP[id];
        if (s && Number.isFinite(s.monthlyBudget)) {
            sum += Math.max(0, s.monthlyBudget);
            anySlice = true;
        }
    }
    if (!anySlice) {
        const raw = Number(root.monthlyBudget ?? 0);
        return { total: Number.isFinite(raw) ? raw : 0, planCurrency: cur };
    }
    return { total: sum, planCurrency: cur };
}
