/** Tailwind class bundles for budget cards — restrained, status-first (not multi-gradient). */

export type BudgetUtilizationLabel = 'Healthy' | 'Watch' | 'Critical';
export type BudgetTierVisual = 'Core' | 'Supporting' | 'Optional';

/** Subtle status tint on card header area (no large mesh orbs). */
export function budgetCardStatusTint(util: BudgetUtilizationLabel): string {
  switch (util) {
    case 'Critical':
      return 'bg-rose-50/80';
    case 'Watch':
      return 'bg-amber-50/60';
    default:
      return 'bg-white';
  }
}

/** @deprecated Use budgetCardStatusTint — kept for tests migrating off orbs. */
export function budgetCardOrbTop(util: BudgetUtilizationLabel): string {
  return budgetCardStatusTint(util);
}

/** @deprecated Orbs removed for performance; returns transparent. */
export function budgetCardOrbBottom(_util: BudgetUtilizationLabel): string {
  return 'opacity-0';
}

/** Thin top accent by utilization (clear at-a-glance signal). */
export function budgetTierTopHairline(util: BudgetUtilizationLabel): string {
  switch (util) {
    case 'Critical':
      return 'from-rose-500 to-rose-600';
    case 'Watch':
      return 'from-amber-400 to-amber-500';
    default:
      return 'from-emerald-500 to-emerald-600';
  }
}

/** Primary utilization bar fill. */
export function budgetProgressGradient(util: BudgetUtilizationLabel): string {
  switch (util) {
    case 'Critical':
      return 'bg-rose-500';
    case 'Watch':
      return 'bg-amber-500';
    default:
      return 'bg-emerald-500';
  }
}

/** Monthly plan bar — neutral slate (distinct from annual). */
export function budgetSecondaryProgressGradient(): string {
  return 'bg-slate-600';
}

export function budgetConsumedSegmentGradient(util: BudgetUtilizationLabel): string {
  return budgetProgressGradient(util);
}

export function budgetMonthlyConsumedSegmentGradient(): string {
  return 'bg-slate-600';
}

export function budgetRemainingSegmentClasses(): string {
  return 'bg-slate-100 ring-1 ring-inset ring-slate-200/90';
}

export function budgetOverBudgetConsumedGradient(): string {
  return 'bg-rose-600';
}

/** Status badge shell (Healthy / Watch / Critical). */
export function budgetUtilizationBadgeClasses(util: BudgetUtilizationLabel): string {
  switch (util) {
    case 'Critical':
      return 'bg-rose-100 text-rose-900 ring-1 ring-rose-200';
    case 'Watch':
      return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
    default:
      return 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200';
  }
}

/** Tier badge — neutral outline, not gradient chips. */
export function budgetTierBadgeClasses(tier: BudgetTierVisual): string {
  switch (tier) {
    case 'Core':
      return 'bg-slate-50 text-slate-800 ring-1 ring-slate-200';
    case 'Supporting':
      return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200';
    default:
      return 'bg-slate-50 text-slate-600 ring-1 ring-slate-200';
  }
}
