/**
 * Goal conflict logic (spec §19).
 * Detect same cash funding too many goals, impossible target dates, priority clashes.
 */

import type { FinancialData, Goal } from '../types';
import { buildGoalFundingScheduleRows } from './goalFundingRouter';
import { monthsRemainingToDeadline } from './goalMetrics';

function targetAmount(g: Goal): number {
  return Number(g.targetAmount ?? (g as { target_amount?: number }).target_amount ?? 0);
}

function currentAmount(g: Goal): number {
  return Number(g.currentAmount ?? (g as { current_amount?: number }).current_amount ?? 0);
}

function targetDate(g: Goal): Date | null {
  const raw = g.deadline ?? (g as { targetDate?: string }).targetDate ?? (g as { target_date?: string }).target_date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface GoalConflict {
  goalIds: string[];
  reason: 'same_cash_source' | 'impossible_date' | 'low_priority_hurts_high' | 'house_delayed_by_trading' | 'travel_reduces_emergency';
  message: string;
  /** Sum of required monthly savings across active goals (same basis as message). */
  requiredMonthlyTotal?: number;
  /** Monthly surplus used in the check. */
  surplusMonthly?: number;
  /** For impossible_date: gap / months left. */
  neededPerMonth?: number;
  /** For impossible_date: goal display name. */
  goalName?: string;
}

function resolvedSaved(g: Goal, map?: Map<string, number>): number {
  if (map != null) return Math.max(0, map.get(g.id) ?? 0);
  return currentAmount(g);
}

/** Fallback run-rate when `data` is not passed: same months model as `buildGoalFundingScheduleRows` (no cockpit asset resolution). */
function requiredMonthlyFallback(goals: Goal[], resolvedMap?: Map<string, number>): Map<string, number> {
  const from = new Date();
  const out = new Map<string, number>();
  goals.forEach((g) => {
    const gap = Math.max(0, targetAmount(g) - resolvedSaved(g, resolvedMap));
    const end = targetDate(g);
    if (gap <= 0 || !end || end.getTime() <= from.getTime()) return;
    const m = Math.max(1, monthsRemainingToDeadline(g, from));
    out.set(g.id, gap / m);
  });
  return out;
}

/**
 * Detect conflicts: too many goals funded from same capacity, impossible target dates, priority clashes.
 * When `data` (+ optional `sarPerUsdUi`) is passed, required monthly run-rates match the Goal funding cockpit.
 */
export function detectGoalConflict(args: {
  goals: Goal[];
  /** Monthly surplus available for goals (after essentials). */
  monthlySurplusForGoals: number;
  /** Optional: monthly already allocated to "house" goal. */
  monthlyToHouseGoal?: number;
  /** Goal id → resolved saved amount SAR (assets + investments + receivables). Used only when `data` is omitted. */
  resolvedCurrentByGoalId?: Map<string, number>;
  /** Full financial data — enables the same schedule as Goal funding cockpit. */
  data?: FinancialData | null;
  /** UI SAR/USD; passed to resolved goal balances when `data` is set. */
  sarPerUsdUi?: number;
}): GoalConflict[] {
  const conflicts: GoalConflict[] = [];
  const goals = args.goals ?? [];
  const surplus = Math.max(0, args.monthlySurplusForGoals ?? 0);
  const resolvedMap = args.resolvedCurrentByGoalId;

  const requiredByGoalId =
    args.data != null
      ? (() => {
            const m = new Map<string, number>();
            buildGoalFundingScheduleRows(args.data, args.sarPerUsdUi).forEach((r) => {
              if (r.requiredPerMonth > 0) m.set(r.goal.id, r.requiredPerMonth);
            });
            return m;
          })()
      : requiredMonthlyFallback(goals, resolvedMap);

  const requiredTotal = [...requiredByGoalId.values()].reduce((s, v) => s + v, 0);

  if (surplus > 0 && requiredTotal > surplus * 1.2) {
    conflicts.push({
      goalIds: goals.filter((g) => targetAmount(g) > resolvedSaved(g, resolvedMap)).map((g) => g.id),
      reason: 'same_cash_source',
      message: `Total required monthly (${Math.round(requiredTotal)}) exceeds available surplus (${Math.round(surplus)}). Same cash is funding too many goals.`,
      requiredMonthlyTotal: requiredTotal,
      surplusMonthly: surplus,
    });
  }

  goals.forEach((g) => {
    const needed = requiredByGoalId.get(g.id);
    if (!(typeof needed === 'number' && needed > 0)) return;
    if (surplus > 0 && needed > surplus) {
      conflicts.push({
        goalIds: [g.id],
        reason: 'impossible_date',
        message: `Target date for "${g.name}" is not achievable with current surplus (need ${Math.round(needed)}/mo, have ${Math.round(surplus)}).`,
        neededPerMonth: needed,
        surplusMonthly: surplus,
        goalName: g.name,
      });
    }
  });

  return conflicts;
}

/**
 * Feasibility: can this goal be met by target date with given monthly contribution?
 */
export function goalFeasibilityCheck(args: {
  goal: Goal;
  monthlyContribution: number;
  fromDate?: Date;
  /** When set, overrides goal.currentAmount for gap math (aligned with Goals page). */
  resolvedCurrentAmount?: number;
}): {
  feasible: boolean;
  monthsNeeded: number | null;
  monthsAvailable: number | null;
  reason: 'funded' | 'no_deadline' | 'no_contribution' | 'timeline';
} {
  const from = args.fromDate ?? new Date();
  const saved =
    typeof args.resolvedCurrentAmount === 'number' && Number.isFinite(args.resolvedCurrentAmount)
      ? Math.max(0, args.resolvedCurrentAmount)
      : currentAmount(args.goal);
  const gap = Math.max(0, targetAmount(args.goal) - saved);
  const end = targetDate(args.goal);
  if (gap <= 0) return { feasible: true, monthsNeeded: 0, monthsAvailable: null, reason: 'funded' };
  if (!end) return { feasible: false, monthsNeeded: null, monthsAvailable: null, reason: 'no_deadline' };
  const monthsAvailableRaw = monthsRemainingToDeadline(args.goal, from);
  const monthsAvailable = monthsAvailableRaw > 0 ? monthsAvailableRaw : 0;
  const monthly = Math.max(0, args.monthlyContribution);
  if (!(monthly > 0)) return { feasible: false, monthsNeeded: null, monthsAvailable, reason: 'no_contribution' };
  const monthsNeeded = Math.ceil(gap / monthly);
  return { feasible: monthsNeeded <= monthsAvailable, monthsNeeded, monthsAvailable, reason: 'timeline' };
}

/**
 * Suggest reprioritization: order goals by priority then by feasibility; return ordered list.
 */
export function reprioritizeConflictingGoals(args: {
  goals: Goal[];
  monthlySurplusForGoals: number;
}): Goal[] {
  const ordered = [...(args.goals ?? [])].sort((a, b) => {
    const pA = a.priority === 'High' ? 3 : a.priority === 'Medium' ? 2 : 1;
    const pB = b.priority === 'High' ? 3 : b.priority === 'Medium' ? 2 : 1;
    if (pA !== pB) return pB - pA;
    const gapA = Math.max(0, targetAmount(a) - currentAmount(a));
    const gapB = Math.max(0, targetAmount(b) - currentAmount(b));
    return gapA - gapB;
  });
  return ordered;
}
