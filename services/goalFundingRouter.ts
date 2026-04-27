import type { FinancialData, Goal } from '../types';
import { computeGoalResolvedAmountsSar } from './goalResolvedTotals';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { monthsRemainingToDeadline } from './goalMetrics';

/** When a goal has no deadline, amortize required monthly amount over this horizon (months). */
export const GOAL_NO_DEADLINE_AMORTIZATION_MONTHS = 60;

export interface GoalFundingSuggestion {
  goalId: string;
  name: string;
  /** Run-rate needed per month to hit deadline (0 if overdue catch-up only). */
  requiredPerMonth: number;
  suggestedPerMonth: number;
  /** Share of monthly surplus bucket (sums to ~1 among monthly-active goals when scarce). */
  priorityShare: number;
  status: 'funded' | 'on_track' | 'need_more';
  /** Full gap when deadline already passed — not a "/month" figure. */
  overdueCatchUpSar?: number;
  /** Months remaining to deadline (for goals with a future deadline). */
  monthsToDeadline?: number;
}

export interface GoalFundingPlan {
  totalMonthlySurplus: number;
  suggestions: GoalFundingSuggestion[];
}

export function computeGoalFundingPlan(
  data: FinancialData | null | undefined,
  projectedAnnualSurplus: number,
  /** SAR per USD from CurrencyContext — enables resolved goal balances (linked assets/investments). */
  sarPerUsdUi?: number,
): GoalFundingPlan {
  const goals = (data?.goals ?? []) as Goal[];
  const monthlySurplus = projectedAnnualSurplus / 12;
  const sarPerUsd = resolveSarPerUsd(data ?? null, sarPerUsdUi);
  const resolvedByGoal = computeGoalResolvedAmountsSar(data, sarPerUsd);

  const now = new Date();

  type Row = {
    goal: Goal;
    shortfall: number;
    requiredPerMonth: number;
    overdueCatchUpSar: number;
    monthsToDeadline: number;
    priorityWeight: number;
  };

  const rows: Row[] = goals.map((g) => {
    const target = Number(g.targetAmount ?? 0);
    const current = Math.max(0, resolvedByGoal.get(g.id) ?? Number(g.currentAmount ?? 0));
    const shortfall = Math.max(0, target - current);
    const deadline = g.deadline ? new Date(g.deadline) : null;
    const dlOk = !!(deadline && !Number.isNaN(deadline.getTime()));

    let requiredPerMonth = 0;
    let overdueCatchUpSar = 0;
    let monthsToDeadline = 0;

    if (shortfall <= 0) {
      return { goal: g, shortfall: 0, requiredPerMonth: 0, overdueCatchUpSar: 0, monthsToDeadline: 0, priorityWeight: 0 };
    }

    if (!dlOk) {
      monthsToDeadline = GOAL_NO_DEADLINE_AMORTIZATION_MONTHS;
      requiredPerMonth = shortfall / GOAL_NO_DEADLINE_AMORTIZATION_MONTHS;
    } else if (deadline!.getTime() <= now.getTime()) {
      overdueCatchUpSar = shortfall;
      requiredPerMonth = 0;
      monthsToDeadline = 0;
    } else {
      monthsToDeadline = Math.max(1, monthsRemainingToDeadline(g, now));
      requiredPerMonth = shortfall / monthsToDeadline;
    }

    const priorityWeight = g.priority === 'High' ? 3 : g.priority === 'Low' ? 1 : 2;
    return { goal: g, shortfall, requiredPerMonth, overdueCatchUpSar, monthsToDeadline, priorityWeight };
  });

  const monthlyActive = rows.filter((e) => e.shortfall > 0 && e.requiredPerMonth > 0);
  const totalRequired = monthlyActive.reduce((sum, e) => sum + e.requiredPerMonth, 0);

  let monthlySuggestions: GoalFundingSuggestion[] = [];

  if (monthlySurplus <= 0 || monthlyActive.length === 0) {
    monthlySuggestions = monthlyActive.map((e) => ({
      goalId: e.goal?.id ?? '',
      name: e.goal?.name ?? '—',
      requiredPerMonth: e.requiredPerMonth,
      suggestedPerMonth: 0,
      priorityShare: 0,
      status: 'need_more' as const,
      monthsToDeadline: e.monthsToDeadline,
    }));
  } else if (monthlySurplus >= totalRequired) {
    monthlySuggestions = monthlyActive.map((e) => ({
      goalId: e.goal?.id ?? '',
      name: e.goal?.name ?? '—',
      requiredPerMonth: e.requiredPerMonth,
      suggestedPerMonth: e.requiredPerMonth,
      priorityShare: totalRequired > 0 ? e.requiredPerMonth / totalRequired : 0,
      status: 'on_track' as const,
      monthsToDeadline: e.monthsToDeadline,
    }));
  } else {
    const totalWeight = monthlyActive.reduce((sum, e) => sum + e.priorityWeight, 0) || 1;
    monthlySuggestions = monthlyActive.map((e) => {
      const share = e.priorityWeight / totalWeight;
      const suggested = monthlySurplus * share;
      const ok = suggested >= e.requiredPerMonth * 0.9;
      return {
        goalId: e.goal?.id ?? '',
        name: e.goal?.name ?? '—',
        requiredPerMonth: e.requiredPerMonth,
        suggestedPerMonth: suggested,
        priorityShare: share,
        status: ok ? ('on_track' as const) : ('need_more' as const),
        monthsToDeadline: e.monthsToDeadline,
      };
    });
  }

  const overdueSuggestions: GoalFundingSuggestion[] = rows
    .filter((e) => e.overdueCatchUpSar > 0)
    .map((e) => ({
      goalId: e.goal?.id ?? '',
      name: e.goal?.name ?? '—',
      requiredPerMonth: 0,
      suggestedPerMonth: 0,
      priorityShare: 0,
      status: 'need_more' as const,
      overdueCatchUpSar: e.overdueCatchUpSar,
      monthsToDeadline: 0,
    }));

  return {
    totalMonthlySurplus: monthlySurplus,
    suggestions: [...monthlySuggestions, ...overdueSuggestions],
  };
}
