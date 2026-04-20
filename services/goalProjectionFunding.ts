import type { Budget, FinancialData, Goal } from '../types';
import { toSAR } from '../utils/currencyMath';
import { computeGoalMonthlyAllocation } from './goalAllocation';
import { averageRollingMonthlyNetSurplus } from './goalResolvedTotals';

/** Monthly SAR equivalent of a budget row limit (matches Budgets page cards). */
export function budgetMonthlyEquivalentSar(b: Budget): number {
  const lim = Math.max(0, Number(b.limit) || 0);
  const p = b.period ?? 'monthly';
  if (p === 'yearly') return lim / 12;
  if (p === 'weekly') return lim * (52 / 12);
  if (p === 'daily') return lim * (365 / 12);
  return lim;
}

/**
 * Monthly funding envelope for goal projections:
 * - Goal-linked budgets + rolling average of goal-linked investment deposits (same window as surplus),
 * - Plus allocation slice of **remaining** rolling surplus after subtracting other goals' linked budget envelopes.
 */
/** Rolling surplus minus all envelopes explicitly tagged with any goal (shared “what’s left” for %-allocation math). */
export function rollingSurplusAfterAllGoalBudgetReservations(data: FinancialData | null | undefined): number {
  const rolling = averageRollingMonthlyNetSurplus(data ?? null);
  let reserved = 0;
  (data?.budgets ?? []).forEach((b) => {
    const gid = String((b as Budget).goalId ?? '').trim();
    if (!gid) return;
    reserved += budgetMonthlyEquivalentSar(b);
  });
  return Math.max(0, rolling - reserved);
}

/**
 * Rolling average (same window as surplus) of cash deposits into portfolios/holdings linked to the goal — SAR.
 */
export function goalMonthlyInvestmentContributionSar(
  goalId: string,
  data: FinancialData | null | undefined,
  sarPerUsd: number,
  monthsBack = 6,
): number {
  const gid = String(goalId ?? '').trim();
  if (!gid || !data) return 0;

  const portfolios =
    (data as { personalInvestments?: typeof data.investments }).personalInvestments ?? data.investments ?? [];
  const portfolioIds = new Set<string>();
  portfolios.forEach((p) => {
    if (String(p.goalId ?? '').trim() === gid) portfolioIds.add(p.id);
    (p.holdings ?? []).forEach((h: { goalId?: string }) => {
      if (String(h.goalId ?? '').trim() === gid) portfolioIds.add(p.id);
    });
  });
  if (portfolioIds.size === 0) return 0;

  const txs = (data.investmentTransactions ?? []).filter((t) => {
    const pid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
    if (!pid || !portfolioIds.has(pid)) return false;
    return t.type === 'deposit';
  });

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  const monthlyTotals = new Map<string, number>();
  txs.forEach((t) => {
    const d = new Date(t.date);
    if (d <= cutoff) return;
    const cur = (t.currency ?? 'USD') as 'USD' | 'SAR';
    const amt = Math.abs(Number(t.total) || 0);
    const sar = toSAR(amt, cur, sarPerUsd);
    const monthKey = String(t.date).slice(0, 7);
    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + sar);
  });

  if (monthlyTotals.size === 0) return 0;
  const sum = Array.from(monthlyTotals.values()).reduce((a, b) => a + b, 0);
  return Math.max(0, sum / monthlyTotals.size);
}

export function computeGoalMonthlyFundingEnvelopeSar(args: {
  goal: Goal;
  data: FinancialData | null | undefined;
  /** FX for investment deposit totals when currency is USD. */
  sarPerUsd?: number;
}): {
  assignedBudgetMonthly: number;
  assignedInvestmentMonthly: number;
  allocationSliceMonthly: number;
  envelopeMonthly: number;
  rollingSurplusMonthly: number;
  reservedByOtherGoalBudgets: number;
} {
  const { goal, data } = args;
  const rate = Number(args.sarPerUsd);
  const sarPerUsd = Number.isFinite(rate) && rate > 0 ? rate : 3.75;
  const gid = String(goal.id || '').trim();
  const rollingSurplusMonthly = averageRollingMonthlyNetSurplus(data ?? null);

  const budgets = (data?.budgets ?? []) as Budget[];
  let assignedBudgetMonthly = 0;
  let reservedByOtherGoalBudgets = 0;

  budgets.forEach((b) => {
    const bid = String((b as Budget & { goalId?: string }).goalId ?? (b as { goal_id?: string }).goal_id ?? '').trim();
    if (!bid) return;
    const m = budgetMonthlyEquivalentSar(b);
    if (bid === gid) assignedBudgetMonthly += m;
    else reservedByOtherGoalBudgets += m;
  });

  const assignedInvestmentMonthly = goalMonthlyInvestmentContributionSar(gid, data ?? null, sarPerUsd);
  const assignedEnvelopeMonthly = assignedBudgetMonthly + assignedInvestmentMonthly;

  const surplusAfterReserved = Math.max(0, rollingSurplusMonthly - reservedByOtherGoalBudgets);
  const allocationSliceMonthly = computeGoalMonthlyAllocation(surplusAfterReserved, goal.savingsAllocationPercent ?? 0);

  return {
    assignedBudgetMonthly,
    assignedInvestmentMonthly,
    allocationSliceMonthly,
    envelopeMonthly: assignedEnvelopeMonthly + allocationSliceMonthly,
    rollingSurplusMonthly,
    reservedByOtherGoalBudgets,
  };
}
