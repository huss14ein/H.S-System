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

type GoalSharesByPortfolio = {
  sharesByPortfolioId: Map<string, Map<string, number>>;
  linkedGoalIds: Set<string>;
  portfolioWeightById: Map<string, number>;
};

function normalizeSharesMap(shares: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const total = Array.from(shares.values()).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (!(total > 0)) return out;
  shares.forEach((value, key) => {
    const safe = Math.max(0, Number(value) || 0);
    if (safe <= 0) return;
    out.set(key, safe / total);
  });
  return out;
}

/** Build per-portfolio goal shares using holding-level links first, then portfolio goal for residual. */
function buildGoalSharesByPortfolio(data: FinancialData | null | undefined): GoalSharesByPortfolio {
  const sharesByPortfolioId = new Map<string, Map<string, number>>();
  const linkedGoalIds = new Set<string>();
  const portfolioWeightById = new Map<string, number>();
  const typedData = data ?? null;
  const portfolios =
    (typedData as { personalInvestments?: Array<{
      id?: string;
      goalId?: string;
      goal_id?: string;
      holdings?: Array<{ goalId?: string; goal_id?: string; currentValue?: number }>;
    }> } | null)?.personalInvestments ??
    typedData?.investments ??
    [];

  portfolios.forEach((portfolio) => {
    const pid = String(portfolio.id ?? '').trim();
    if (!pid) return;
    const holdings = (portfolio.holdings ?? []) as Array<{ goalId?: string; goal_id?: string; currentValue?: number }>;
    const portfolioGoal = String(
      (portfolio as { goalId?: string; goal_id?: string }).goalId ??
      (portfolio as { goal_id?: string }).goal_id ??
      '',
    ).trim();

    const holdingValues = holdings.map((h) => Math.max(0, Number(h.currentValue) || 0));
    const totalHoldingsValue = holdingValues.reduce((sum, value) => sum + value, 0);
    const explicitByGoal = new Map<string, number>();
    let explicitTotal = 0;
    let unlinkedValue = 0;
    let unlinkedCount = 0;

    holdings.forEach((h, idx) => {
      const hidGoal = String(h.goalId ?? h.goal_id ?? '').trim();
      const hVal = Math.max(0, holdingValues[idx] || 0);
      if (hidGoal) {
        explicitByGoal.set(hidGoal, (explicitByGoal.get(hidGoal) ?? 0) + hVal);
        explicitTotal += hVal;
      } else {
        unlinkedValue += hVal;
        unlinkedCount += 1;
      }
    });

    const shares = new Map<string, number>();
    if (totalHoldingsValue > 0) {
      explicitByGoal.forEach((value, gid) => {
        if (value > 0) shares.set(gid, (shares.get(gid) ?? 0) + value / totalHoldingsValue);
      });
      if (portfolioGoal && unlinkedValue > 0) {
        shares.set(portfolioGoal, (shares.get(portfolioGoal) ?? 0) + unlinkedValue / totalHoldingsValue);
      } else if (portfolioGoal && explicitTotal < totalHoldingsValue) {
        // Fallback guard for any residual not captured by explicit holding links.
        const residual = Math.max(0, totalHoldingsValue - explicitTotal);
        if (residual > 0) shares.set(portfolioGoal, (shares.get(portfolioGoal) ?? 0) + residual / totalHoldingsValue);
      }
      portfolioWeightById.set(pid, totalHoldingsValue);
    } else if (holdings.length > 0) {
      const explicitCountByGoal = new Map<string, number>();
      holdings.forEach((h) => {
        const hidGoal = String(h.goalId ?? h.goal_id ?? '').trim();
        if (hidGoal) explicitCountByGoal.set(hidGoal, (explicitCountByGoal.get(hidGoal) ?? 0) + 1);
      });
      const totalCount = holdings.length;
      explicitCountByGoal.forEach((count, gid) => {
        shares.set(gid, (shares.get(gid) ?? 0) + count / totalCount);
      });
      if (portfolioGoal && unlinkedCount > 0) {
        shares.set(portfolioGoal, (shares.get(portfolioGoal) ?? 0) + unlinkedCount / totalCount);
      }
      portfolioWeightById.set(pid, Math.max(1, totalCount));
    } else if (portfolioGoal) {
      shares.set(portfolioGoal, 1);
      portfolioWeightById.set(pid, 1);
    }

    const normalized = normalizeSharesMap(shares);
    if (normalized.size > 0) {
      normalized.forEach((_, gid) => linkedGoalIds.add(gid));
      sharesByPortfolioId.set(pid, normalized);
    }
  });

  return { sharesByPortfolioId, linkedGoalIds, portfolioWeightById };
}

function goalAllocationFallbackShare(goalId: string, data: FinancialData | null | undefined): number {
  const gid = String(goalId ?? '').trim();
  const goals = data?.goals ?? [];
  if (!gid || goals.length === 0) return 0;

  const rows = goals.map((g) => ({
    id: String(g.id ?? '').trim(),
    pct: Math.max(0, Number(g.savingsAllocationPercent ?? 0)),
  })).filter((g) => g.id);
  const me = rows.find((g) => g.id === gid);
  if (!me) return 0;
  const totalPct = rows.reduce((sum, g) => sum + g.pct, 0);
  if (totalPct > 0) return me.pct / totalPct;
  if (rows.length === 1) return 1;
  return 1 / rows.length;
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
  const { sharesByPortfolioId } = buildGoalSharesByPortfolio(data ?? null);
  if (sharesByPortfolioId.size === 0) return 0;

  const txs = (data.investmentTransactions ?? []).filter((t) => {
    const pid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
    if (!pid || !sharesByPortfolioId.has(pid)) return false;
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
    const pid = String(t.portfolioId ?? (t as { portfolio_id?: string }).portfolio_id ?? '').trim();
    const share = sharesByPortfolioId.get(pid)?.get(gid) ?? 0;
    if (!(share > 0)) return;
    const monthKey = String(t.date).slice(0, 7);
    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + sar * share);
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
  const { sharesByPortfolioId, linkedGoalIds, portfolioWeightById } = buildGoalSharesByPortfolio(data ?? null);

  type GoalPlanSlice = {
    monthlyBudget?: number;
    monthly_budget?: number;
    budgetCurrency?: 'USD' | 'SAR';
    budget_currency?: 'USD' | 'SAR';
  };
  type GoalPlanLike = GoalPlanSlice & {
    plansByPortfolioId?: Record<string, GoalPlanSlice>;
    plans_by_portfolio_id?: Record<string, GoalPlanSlice>;
  };
  const plan = (data.investmentPlan as unknown as GoalPlanLike | undefined) ?? undefined;
  if (!plan) return 0;
  const planCurrency = ((plan.budgetCurrency ?? plan.budget_currency ?? 'SAR') as 'USD' | 'SAR') ?? 'SAR';

  const rawSlices =
    (plan.plansByPortfolioId as Record<string, Record<string, unknown>> | undefined) ??
    (plan.plans_by_portfolio_id as Record<string, Record<string, unknown>> | undefined);
  const hasSlices = !!rawSlices && Object.keys(rawSlices).length > 0;
  let slicesTotalMonthly = 0;
  let mappedForGoalMonthly = 0;
  let mappedAllGoalsMonthly = 0;
  if (rawSlices) {
    Object.entries(rawSlices).forEach(([pid, slice]) => {
      if (!slice) return;
      const monthly = Number(slice.monthlyBudget ?? slice.monthly_budget ?? 0);
      if (!(Number.isFinite(monthly) && monthly > 0)) return;
      slicesTotalMonthly += monthly;
      const shares = sharesByPortfolioId.get(pid);
      if (!shares || shares.size === 0) return;
      let sumShares = 0;
      shares.forEach((share, goalKey) => {
        if (!(share > 0)) return;
        sumShares += share;
        if (goalKey === gid) mappedForGoalMonthly += monthly * share;
      });
      mappedAllGoalsMonthly += monthly * Math.min(1, sumShares);
    });
  }
  if (slicesTotalMonthly > 0) {
    const unmappedMonthly = Math.max(0, slicesTotalMonthly - mappedAllGoalsMonthly);
    const fallback = unmappedMonthly * goalAllocationFallbackShare(gid, data);
    return Math.max(0, toSAR(mappedForGoalMonthly + fallback, planCurrency, sarPerUsd));
  }
  if (hasSlices) return 0;

  const rootMonthly = Number(plan.monthlyBudget ?? plan.monthly_budget ?? 0);
  if (!Number.isFinite(rootMonthly) || rootMonthly <= 0) return 0;
  if (linkedGoalIds.size > 0 && sharesByPortfolioId.size > 0) {
    const weightedByGoal = new Map<string, number>();
    let weightedTotal = 0;
    sharesByPortfolioId.forEach((shares, pid) => {
      const weight = Math.max(0, Number(portfolioWeightById.get(pid) ?? 0));
      if (!(weight > 0)) return;
      shares.forEach((share, goalKey) => {
        if (!(share > 0)) return;
        const contrib = weight * share;
        weightedByGoal.set(goalKey, (weightedByGoal.get(goalKey) ?? 0) + contrib);
        weightedTotal += contrib;
      });
    });
    if (weightedTotal > 0) {
      const goalShare = Math.max(0, (weightedByGoal.get(gid) ?? 0) / weightedTotal);
      return Math.max(0, toSAR(rootMonthly * goalShare, planCurrency, sarPerUsd));
    }
  }

  // No explicit goal links in investments: infer mapping from saved goal allocation strategy.
  const fallbackShare = goalAllocationFallbackShare(gid, data);
  return Math.max(0, toSAR(rootMonthly * fallbackShare, planCurrency, sarPerUsd));
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
