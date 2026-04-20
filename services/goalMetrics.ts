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
/** Months until deadline from `fromDate` (ceil); 0 if past/missing deadline. */
export function monthsRemainingToDeadline(goal: Goal, fromDate: Date = new Date()): number {
  const deadline = goal.deadline ? new Date(goal.deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) return 0;
  const diffMs = deadline.getTime() - fromDate.getTime();
  if (diffMs <= 0) return 0;
  const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
  return Math.ceil(diffMs / MONTH_MS);
}

/**
 * Same status logic as Goals → GoalCard: compares allocation-based monthly contribution
 * to equal-payment requirement from remaining gap ÷ months left.
 */
export function computeGoalTimelineStatus(args: {
  goal: Goal;
  /** Resolved saved amount (assets + investments + receivables), same as Goals page. */
  resolvedCurrentAmountSar: number;
  /** monthlySavings × (savingsAllocationPercent / 100) */
  projectedMonthlyContribution: number;
  fromDate?: Date;
}): {
  status: 'On Track' | 'Needs Attention' | 'At Risk';
  monthsLeft: number;
  progressPercent: number;
  requiredMonthlyContribution: number;
  projectedMonthlyContribution: number;
} {
  const from = args.fromDate ?? new Date();
  const targetAmt = Number(args.goal.targetAmount ?? (args.goal as { target_amount?: number }).target_amount ?? 0);
  const currentAmount = Math.max(0, args.resolvedCurrentAmountSar);
  const progressPercentRaw = targetAmt > 0 ? (currentAmount / targetAmt) * 100 : 0;
  const progressPercent = Math.min(100, Math.max(0, progressPercentRaw));

  const monthsLeft = monthsRemainingToDeadline(args.goal, from);
  const remainingAmount = Math.max(0, targetAmt - currentAmount);
  const requiredMonthlyContribution =
    monthsLeft > 0 ? remainingAmount / monthsLeft : remainingAmount;
  const projectedMonthlyContribution = Math.max(0, args.projectedMonthlyContribution);

  let status: 'On Track' | 'Needs Attention' | 'At Risk' = 'On Track';
  if (progressPercent >= 100) {
    status = 'On Track';
  } else if (monthsLeft <= 0) {
    status = 'At Risk';
  } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.5) {
    status = 'At Risk';
  } else if (projectedMonthlyContribution > 0 && projectedMonthlyContribution < requiredMonthlyContribution * 0.8) {
    status = 'Needs Attention';
  }

  return {
    status,
    monthsLeft,
    progressPercent,
    requiredMonthlyContribution,
    projectedMonthlyContribution,
  };
}

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
