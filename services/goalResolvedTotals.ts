/**
 * Single source for "how much is saved toward this goal" in SAR:
 * linked personal assets + investments (portfolio/holding goal links) + active receivables linked to the goal.
 * Matches Goals page / GoalCard `calculatedCurrentAmount` logic.
 */

import type { FinancialData, Goal, Liability } from '../types';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { personalMonthlyNetByMonthKeySar } from './financeMetrics';
import { receivableContributionForGoal } from './goalReceivableContribution';

export function computeGoalResolvedAmountsSar(
  data: FinancialData | null | undefined,
  sarPerUsd: number,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!data) return map;

  const add = (goalId: string, valueSar: number) => {
    if (!goalId || !Number.isFinite(valueSar)) return;
    map.set(goalId, (map.get(goalId) ?? 0) + valueSar);
  };

  const assets = (data as { personalAssets?: typeof data.assets }).personalAssets ?? data.assets ?? [];
  assets.forEach((a: { goalId?: string; value?: number }) => {
    if (a.goalId) add(a.goalId, Number(a.value) || 0);
  });

  const investments =
    (data as { personalInvestments?: typeof data.investments }).personalInvestments ?? data.investments ?? [];
  investments.forEach((p: { goalId?: string; currency?: string; holdings?: { goalId?: string; currentValue?: number }[] }) => {
    const holdings = p.holdings ?? [];
    const cur = (p.currency ?? 'USD') as 'USD' | 'SAR';
    // Match Goals card: each lot resolves to `holding.goalId ?? portfolio.goalId` (never assign the whole book to the portfolio goal while ignoring per-lot links).
    holdings.forEach((h: { goalId?: string; currentValue?: number }) => {
      const gid = h.goalId ?? p.goalId;
      if (!gid) return;
      add(gid, toSAR(h.currentValue ?? 0, cur, sarPerUsd));
    });
  });

  const liabilities = ((data as { personalLiabilities?: Liability[] }).personalLiabilities ?? data.liabilities ?? []) as Liability[];
  liabilities.forEach((l) => {
    const gid = l.goalId;
    if (!gid) return;
    const v = receivableContributionForGoal(l, gid);
    if (v > 0) add(gid, v);
  });

  return map;
}

/** Merge resolved SAR totals onto goal rows for engines that read `currentAmount`. */
/**
 * Rolling average monthly external net cash flow (income − expenses) in **SAR**, same basis as Forecast / Summary.
 * Uses dated FX when available (`personalMonthlyNetByMonthKeySar`).
 */
export function averageRollingMonthlyNetSurplus(
  data: FinancialData | null | undefined,
  monthsBack = 6,
  uiExchangeRate?: number,
): number {
  if (!data) return 0;
  const rate =
    uiExchangeRate !== undefined && Number.isFinite(uiExchangeRate) && uiExchangeRate > 0
      ? uiExchangeRate
      : resolveSarPerUsd(data, undefined);
  const { values } = personalMonthlyNetByMonthKeySar(data, rate, monthsBack);
  if (values.length === 0) return 0;
  const totalNet = values.reduce((sum, net) => sum + net, 0);
  return Math.max(0, totalNet / values.length);
}

export function goalsWithResolvedCurrentAmount(data: FinancialData | null | undefined, sarPerUsd: number): (Goal & { currentAmount: number })[] {
  const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
  const goals = (data?.goals ?? []) as Goal[];
  return goals.map((g) => ({
    ...g,
    currentAmount: resolved.get(g.id) ?? 0,
  }));
}

/** Compact string for AI cache keys when goal funding changes. */
export function resolvedGoalAmountsFingerprint(data: FinancialData | null | undefined, sarPerUsd: number): string {
  const m = computeGoalResolvedAmountsSar(data, sarPerUsd);
  let sumHalalas = 0;
  m.forEach((v) => {
    sumHalalas += Math.round(Math.max(0, v) * 100);
  });
  return `${m.size}:${sumHalalas}`;
}

/** One-line progress list for Gemini prompts (same % basis as Goals / dashboards). */
export function formatGoalsProgressForPrompt(data: FinancialData | null | undefined, sarPerUsd: number): string {
  const resolved = computeGoalResolvedAmountsSar(data, sarPerUsd);
  const goals = (data?.goals ?? []) as Goal[];
  return goals
    .map((g) => {
      const current = resolved.get(g.id) ?? 0;
      const target = Number(g.targetAmount) || 0;
      const progress = target > 0 ? (current / target) * 100 : 0;
      return `${g.name ?? ''} (${progress.toFixed(0)}%)`;
    })
    .join(', ');
}
