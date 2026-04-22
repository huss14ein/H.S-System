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

/**
 * Goal-linked share of configured Investment Plan monthly budget (SAR).
 *
 * Mapping strategy:
 * - Preferred: sum per-portfolio plan slices (`plansByPortfolioId`) for portfolios linked to the goal.
 * - Legacy fallback: when no per-portfolio slices exist, use root `monthlyBudget` only if
 *   all investment goal links point to this same goal (prevents cross-goal double counting).
 */
export function goalMonthlyInvestmentPlanContributionSar(
  goalId: string,
  data: FinancialData | null | undefined,
  sarPerUsd: number,
): number {
  const gid = String(goalId ?? '').trim();
  if (!gid || !data) return 0;

  const portfolios =
    (data as { personalInvestments?: typeof data.investments }).personalInvestments ?? data.investments ?? [];
  if (!portfolios.length) return 0;

  const linkedPortfolioIds = new Set<string>();
  const linkedGoalIdsInInvestments = new Set<string>();
  portfolios.forEach((p) => {
    const pid = String(p.id ?? '').trim();
    if (!pid) return;
    const portfolioGoal = String((p as { goalId?: string; goal_id?: string }).goalId ?? (p as { goal_id?: string }).goal_id ?? '').trim();
    if (portfolioGoal) linkedGoalIdsInInvestments.add(portfolioGoal);
    if (portfolioGoal === gid) linkedPortfolioIds.add(pid);
    (p.holdings ?? []).forEach((h: { goalId?: string; goal_id?: string }) => {
      const holdingGoal = String(h.goalId ?? h.goal_id ?? '').trim();
      if (!holdingGoal) return;
      linkedGoalIdsInInvestments.add(holdingGoal);
      if (holdingGoal === gid) linkedPortfolioIds.add(pid);
    });
  });
  if (linkedPortfolioIds.size === 0) return 0;

  const plan = (data as { investmentPlan?: Record<string, unknown> }).investmentPlan as Record<string, unknown> | undefined;
  if (!plan) return 0;
  const planCurrency = ((plan.budgetCurrency ?? plan.budget_currency ?? 'SAR') as 'USD' | 'SAR') ?? 'SAR';

  const rawSlices =
    (plan.plansByPortfolioId as Record<string, Record<string, unknown>> | undefined) ??
    (plan.plans_by_portfolio_id as Record<string, Record<string, unknown>> | undefined);
  const hasSlices = !!rawSlices && Object.keys(rawSlices).length > 0;
  let slicesMonthly = 0;
  if (rawSlices) {
    linkedPortfolioIds.forEach((pid) => {
      const slice = rawSlices[pid];
      if (!slice) return;
      const monthly = Number(slice.monthlyBudget ?? slice.monthly_budget ?? 0);
      if (Number.isFinite(monthly) && monthly > 0) slicesMonthly += monthly;
    });
  }
  if (slicesMonthly > 0) return Math.max(0, toSAR(slicesMonthly, planCurrency, sarPerUsd));
  if (hasSlices) return 0;

  // Legacy root-only plan: map only when all investment links resolve to this single goal.
  if (linkedGoalIdsInInvestments.size !== 1 || !linkedGoalIdsInInvestments.has(gid)) return 0;
  const rootMonthly = Number(plan.monthlyBudget ?? plan.monthly_budget ?? 0);
  if (!Number.isFinite(rootMonthly) || rootMonthly <= 0) return 0;
  return Math.max(0, toSAR(rootMonthly, planCurrency, sarPerUsd));
}

export function computeGoalMonthlyFundingEnvelopeSar(args: {
  goal: Goal;
  data: FinancialData | null | undefined;
  /** FX for investment deposit totals when currency is USD. */
  sarPerUsd?: number;
}): {
  assignedBudgetMonthly: number;
  assignedInvestmentDepositMonthly: number;
  assignedInvestmentPlanMonthly: number;
  assignedInvestmentMonthly: number;
  assignedInvestmentSource: 'plan' | 'deposits' | 'none';
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

  const assignedInvestmentDepositMonthly = goalMonthlyInvestmentContributionSar(gid, data ?? null, sarPerUsd);
  const assignedInvestmentPlanMonthly = goalMonthlyInvestmentPlanContributionSar(gid, data ?? null, sarPerUsd);
  const assignedInvestmentMonthly = Math.max(assignedInvestmentDepositMonthly, assignedInvestmentPlanMonthly);
  const assignedInvestmentSource =
    assignedInvestmentMonthly <= 0
      ? 'none'
      : assignedInvestmentPlanMonthly >= assignedInvestmentDepositMonthly
        ? 'plan'
        : 'deposits';
  const assignedEnvelopeMonthly = assignedBudgetMonthly + assignedInvestmentMonthly;

  const surplusAfterReserved = Math.max(0, rollingSurplusMonthly - reservedByOtherGoalBudgets);
  const allocationSliceMonthly = computeGoalMonthlyAllocation(surplusAfterReserved, goal.savingsAllocationPercent ?? 0);

  return {
    assignedBudgetMonthly,
    assignedInvestmentDepositMonthly,
    assignedInvestmentPlanMonthly,
    assignedInvestmentMonthly,
    assignedInvestmentSource,
    allocationSliceMonthly,
    envelopeMonthly: assignedEnvelopeMonthly + allocationSliceMonthly,
    rollingSurplusMonthly,
    reservedByOtherGoalBudgets,
  };
}
