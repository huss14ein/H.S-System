import type { FinancialData, Goal } from '../types';

export interface GoalFundingSuggestion {
  goalId: string;
  name: string;
  requiredPerMonth: number;
  suggestedPerMonth: number;
  priorityShare: number;
  status: 'funded' | 'on_track' | 'need_more';
}

export interface GoalFundingPlan {
  totalMonthlySurplus: number;
  suggestions: GoalFundingSuggestion[];
}

export function computeGoalFundingPlan(
  data: FinancialData | null | undefined,
  projectedAnnualSurplus: number
): GoalFundingPlan {
  const goals = (data?.goals ?? []) as Goal[];
  const monthlySurplus = projectedAnnualSurplus / 12;

  const now = new Date();
  const enriched = goals.map(g => {
    const target = Number(g.targetAmount ?? 0);
    const current = Number(g.currentAmount ?? 0);
    const shortfall = Math.max(0, target - current);
    const deadline = new Date(g.deadline);
    const monthsRemaining =
      deadline > now
        ? Math.ceil((deadline.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
        : 0;
    const requiredPerMonth =
      monthsRemaining > 0 && shortfall > 0 ? shortfall / monthsRemaining : shortfall;
    const priorityWeight = g.priority === 'High' ? 3 : g.priority === 'Low' ? 1 : 2;
    return { goal: g, shortfall, requiredPerMonth, priorityWeight };
  });

  const active = enriched.filter(e => e.shortfall > 0 && e.requiredPerMonth > 0);
  const totalRequired = active.reduce((sum, e) => sum + e.requiredPerMonth, 0);

  let suggestions: GoalFundingSuggestion[] = [];

  if (monthlySurplus <= 0 || active.length === 0) {
    suggestions = active.map(e => ({
      goalId: e.goal?.id ?? '',
      name: e.goal?.name ?? '—',
      requiredPerMonth: e.requiredPerMonth,
      suggestedPerMonth: 0,
      priorityShare: 0,
      status: 'need_more',
    }));
  } else if (monthlySurplus >= totalRequired) {
    suggestions = active.map(e => ({
      goalId: e.goal?.id ?? '',
      name: e.goal?.name ?? '—',
      requiredPerMonth: e.requiredPerMonth,
      suggestedPerMonth: e.requiredPerMonth,
      priorityShare: monthlySurplus > 0 ? e.requiredPerMonth / monthlySurplus : 0,
      status: 'on_track',
    }));
  } else {
    const totalWeight = active.reduce((sum, e) => sum + e.priorityWeight, 0) || 1;
    suggestions = active.map(e => {
      const share = e.priorityWeight / totalWeight;
      const suggested = monthlySurplus * share;
      const status =
        suggested >= e.requiredPerMonth * 0.9
          ? 'on_track'
          : suggested >= e.requiredPerMonth * 0.5
          ? 'need_more'
          : 'need_more';
      return {
        goalId: e.goal?.id ?? '',
        name: e.goal?.name ?? '—',
        requiredPerMonth: e.requiredPerMonth,
        suggestedPerMonth: suggested,
        priorityShare: share,
        status,
      };
    });
  }

  return {
    totalMonthlySurplus: monthlySurplus,
    suggestions,
  };
}

