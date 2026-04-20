import type { Goal } from '../types';

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/** After completing a goal, suggest next funding target by priority then deadline. */
export function suggestWaterfallNextGoal(
  completedGoalId: string,
  goals: Goal[],
  /** Optional resolved saved amounts (SAR), same basis as Goals page — overrides `goal.currentAmount`. */
  resolvedCurrentByGoalId?: Map<string, number>,
): Goal | null {
  const open = goals.filter((g) => g.id !== completedGoalId);
  const notMet = open.filter((g) => {
    const cur =
      resolvedCurrentByGoalId != null && resolvedCurrentByGoalId.has(g.id)
        ? (resolvedCurrentByGoalId.get(g.id) ?? 0)
        : (g.currentAmount ?? 0);
    return cur < (g.targetAmount ?? 1);
  });
  if (notMet.length === 0) return null;
  return [...notMet].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority || 'Medium'] ?? 1;
    const pb = PRIORITY_ORDER[b.priority || 'Medium'] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  })[0];
}

export interface BonusRule {
  id: string;
  label: string;
  percentToGoalId?: string;
  percentToInvest: number;
  percentToBuffer: number;
}

export const DEFAULT_BONUS_RULES: BonusRule[] = [
  { id: 'default', label: '50% goals / 40% invest / 10% buffer', percentToInvest: 40, percentToBuffer: 10 },
];
