import type { FinancialData, Goal } from '../types';
import {
  computeGoalMonthlyFundingEnvelopeSar,
  sumAllGoalMonthlyFundingEnvelopesSar,
} from './goalProjectionFunding';
import { resolveSarPerUsd } from '../utils/currencyMath';

export type GoalConflict = {
  id: string;
  severity: 'warn' | 'critical';
  message: string;
  goalIds: string[];
};

export function detectGoalConflicts(
  goals: Goal[],
  /** Ignored when `data` is provided — overload uses mapped envelopes. */
  _monthlySurplusSar?: number,
  data?: FinancialData | null,
  sarPerUsdUi?: number,
): GoalConflict[] {
  const active = goals ?? [];
  const conflicts: GoalConflict[] = [];
  const sarPerUsd = resolveSarPerUsd(data ?? null, sarPerUsdUi);

  const totalRequired = active.reduce((s, g) => {
    const gap = Math.max(0, (Number(g.targetAmount) || 0) - (Number(g.currentAmount) || 0));
    const monthsLeft = Math.max(1, monthsUntilTarget(g));
    return s + gap / monthsLeft;
  }, 0);

  const totalEnvelope = data
    ? sumAllGoalMonthlyFundingEnvelopesSar(data, sarPerUsd)
    : Math.max(0, _monthlySurplusSar ?? 0);

  if (totalEnvelope > 0 && totalRequired > totalEnvelope * 1.2) {
    conflicts.push({
      id: 'funding-overload',
      severity: 'critical',
      message: `Combined required monthly funding (~${Math.round(totalRequired)} SAR) exceeds mapped goal envelopes (~${Math.round(totalEnvelope)} SAR/mo).`,
      goalIds: active.map((g) => g.id),
    });
  }

  const impossible = active.filter((g) => {
    const gap = Math.max(0, (Number(g.targetAmount) || 0) - (Number(g.currentAmount) || 0));
    const months = monthsUntilTarget(g);
    const envelope = data
      ? computeGoalMonthlyFundingEnvelopeSar({ goal: g, data, sarPerUsd }).envelopeMonthly
      : Math.max(0, _monthlySurplusSar ?? 0);
    return months <= 3 && gap > envelope * months * 2;
  });
  if (impossible.length) {
    conflicts.push({
      id: 'impossible-dates',
      severity: 'warn',
      message: `${impossible.length} goal(s) have tight deadlines vs mapped monthly funding.`,
      goalIds: impossible.map((g) => g.id),
    });
  }
  return conflicts;
}

function monthsUntilTarget(g: Goal): number {
  if (!g.deadline) return 24;
  const end = new Date(g.deadline);
  const now = new Date();
  const diff = (end.getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000);
  return Math.max(1, Math.ceil(diff));
}

export function detectGoalConflictsFromData(
  data: FinancialData,
  sarPerUsdUi?: number,
): GoalConflict[] {
  const sarPerUsd = resolveSarPerUsd(data, sarPerUsdUi);
  return detectGoalConflicts(data.goals ?? [], undefined, data, sarPerUsd);
}
