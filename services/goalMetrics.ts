import type { Goal } from '../types';

function targetAmount(g: Goal): number {
  return Number(g.targetAmount ?? (g as any).target_amount ?? 0);
}

function currentAmount(g: Goal): number {
  return Number(g.currentAmount ?? (g as any).current_amount ?? 0);
}

function targetDate(g: Goal): Date | null {
  const raw = g.deadline ?? (g as any).targetDate ?? (g as any).target_date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function goalProgressPercent(goal: Goal): number {
  const t = targetAmount(goal);
  if (t <= 0) return 0;
  return Math.min(100, Math.max(0, (currentAmount(goal) / t) * 100));
}

export function goalFundingGap(goal: Goal): number {
  return Math.max(0, targetAmount(goal) - currentAmount(goal));
}

/** Equal monthly contribution to close gap by target date (0 if no date or past). */
export function requiredMonthlyContribution(goal: Goal, fromDate: Date = new Date()): number {
  const gap = goalFundingGap(goal);
  if (gap <= 0) return 0;
  const end = targetDate(goal);
  if (!end) return gap;
  const months = (end.getFullYear() - fromDate.getFullYear()) * 12 + (end.getMonth() - fromDate.getMonth());
  const m = Math.max(1, months);
  return gap / m;
}

export function projectedGoalCompletionDate(
  goal: Goal,
  monthlyContribution: number,
  fromDate: Date = new Date()
): Date | null {
  const gap = goalFundingGap(goal);
  if (gap <= 0) return fromDate;
  if (monthlyContribution <= 0) return null;
  const monthsNeeded = Math.ceil(gap / monthlyContribution);
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + monthsNeeded);
  return d;
}

/**
 * Inflation-adjust the goal's target cost into nominal future value.
 * This is useful when contribution plans assume a changing purchasing power.
 */
export function inflationAdjustedGoalCost(args: {
  goal: Goal;
  annualInflationRatePct: number;
  /** Baseline date for the inflation adjustment; defaults to now. */
  fromDate?: Date;
}): number {
  const { goal } = args;
  const annualInflationRatePct = Number(args.annualInflationRatePct) || 0;
  const fromDate = args.fromDate ?? new Date();
  const end = targetDate(goal);
  const target = targetAmount(goal);
  if (!end) return target;

  const years = (end.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const inflation = annualInflationRatePct / 100;
  // compound nominal growth into the future deadline
  return target * Math.pow(1 + Math.max(0, inflation), Math.max(0, years));
}

/**
 * Inflation-aware required monthly contribution.
 * Simplified approach: inflate the goal target into nominal deadline value,
 * then compute a flat monthly amount to close the nominal gap.
 */
export function requiredMonthlyContributionInflationAdjusted(args: {
  goal: Goal;
  annualInflationRatePct: number;
  fromDate?: Date;
}): number {
  const fromDate = args.fromDate ?? new Date();
  const inflatedTarget = inflationAdjustedGoalCost({
    goal: args.goal,
    annualInflationRatePct: args.annualInflationRatePct,
    fromDate,
  });
  const current = currentAmount(args.goal);
  const gap = Math.max(0, inflatedTarget - current);
  if (gap <= 0) return 0;
  const end = targetDate(args.goal);
  if (!end) return gap;
  const months = (end.getFullYear() - fromDate.getFullYear()) * 12 + (end.getMonth() - fromDate.getMonth());
  const m = Math.max(1, months);
  return gap / m;
}
