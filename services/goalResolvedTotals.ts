/**
 * Single source for "how much is saved toward this goal" in SAR:
 * linked personal assets + investments (portfolio/holding goal links) + active receivables
 * + idle platform (Investment account) cash attributed to goal-linked portfolios/holdings.
 * Matches Goals page / GoalCard `calculatedCurrentAmount` logic.
 */

import type { FinancialData, Goal, Liability, InvestmentPortfolio, SukukPosition } from '../types';
import { resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { getPersonalAccounts, getPersonalInvestments, getPersonalSukukPositions } from '../utils/wealthScope';
import { getTradableCashBucketsForAccount } from './investmentCashLedger';
import { personalMonthlyNetByMonthKeySar } from './financeMetrics';
import { receivableContributionForGoal } from './goalReceivableContribution';

/**
 * Single lookback window (calendar months) for Goals-page net cashflow: savings allocation banner,
 * surplus after goal-linked budgets, goal funding envelopes, and alignment with the funding cockpit baseline (÷12).
 */
export const GOAL_NET_CASHFLOW_LOOKBACK_MONTHS = 12;

export type GoalPlatformCashSlice = {
  accountId: string;
  accountName: string;
  amountSar: number;
};

/**
 * Attribute each Investment platform's tradable cash once across goals linked on that platform
 * (holding.goalId ?? portfolio.goalId), weighted by holding market value. Empty goal-linked
 * portfolios receive 100% of that portfolio's weight share of platform cash.
 * Unlinked platforms (no goal on portfolio/holdings) contribute nothing.
 */
export function computeGoalPlatformCashByGoalSar(
  data: FinancialData | null | undefined,
  sarPerUsd: number,
): Map<string, GoalPlatformCashSlice[]> {
  const byGoal = new Map<string, GoalPlatformCashSlice[]>();
  if (!data) return byGoal;

  const accounts = getPersonalAccounts(data);
  const investments = getPersonalInvestments(data) as InvestmentPortfolio[];
  if (!accounts.length || !investments.length) return byGoal;

  type PfRow = {
    portfolio: InvestmentPortfolio;
    platformId: string;
    goalWeights: Map<string, number>;
    weightTotal: number;
  };

  const rows: PfRow[] = [];
  for (const p of investments) {
    const platformRaw = String(p.accountId ?? (p as { account_id?: string }).account_id ?? '').trim();
    const platformId = resolveCanonicalAccountId(platformRaw, accounts) || platformRaw;
    if (!platformId) continue;
    const book = resolveInvestmentPortfolioCurrency(p);
    const holdings = p.holdings ?? [];
    const goalWeights = new Map<string, number>();
    let weightTotal = 0;
    if (holdings.length === 0) {
      const gid = String(p.goalId ?? '').trim();
      if (gid) {
        goalWeights.set(gid, 1);
        weightTotal = 1;
      }
    } else {
      holdings.forEach((h) => {
        const gid = String(h.goalId ?? p.goalId ?? '').trim();
        if (!gid) return;
        const w = Math.max(0, toSAR(Number(h.currentValue) || 0, book, sarPerUsd));
        if (!(w > 0)) return;
        goalWeights.set(gid, (goalWeights.get(gid) ?? 0) + w);
        weightTotal += w;
      });
      // Empty-value lots still linked: fall back to equal weight among linked lots / portfolio goal.
      if (weightTotal <= 0) {
        let linked = 0;
        holdings.forEach((h) => {
          if (String(h.goalId ?? p.goalId ?? '').trim()) linked += 1;
        });
        if (linked > 0) {
          holdings.forEach((h) => {
            const gid = String(h.goalId ?? p.goalId ?? '').trim();
            if (!gid) return;
            goalWeights.set(gid, (goalWeights.get(gid) ?? 0) + 1);
            weightTotal += 1;
          });
        } else if (String(p.goalId ?? '').trim()) {
          goalWeights.set(String(p.goalId), 1);
          weightTotal = 1;
        }
      }
    }
    if (weightTotal <= 0 || goalWeights.size === 0) continue;
    rows.push({ portfolio: p, platformId, goalWeights, weightTotal });
  }

  const byPlatform = new Map<string, PfRow[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platformId) ?? [];
    list.push(row);
    byPlatform.set(row.platformId, list);
  }

  for (const [platformId, pfRows] of byPlatform) {
    const cashBucket = getTradableCashBucketsForAccount(platformId, accounts);
    const cashSar = tradableCashBucketToSAR(cashBucket, sarPerUsd);
    if (!(cashSar > 0)) continue;

    const platformWeight = pfRows.reduce((s, r) => s + r.weightTotal, 0);
    if (!(platformWeight > 0)) continue;

    const acc = accounts.find((a) => a.id === platformId) ?? accounts.find((a) => resolveCanonicalAccountId(a.id, accounts) === platformId);
    const accountName = String(acc?.name ?? 'Platform').trim() || 'Platform';

    const goalCash = new Map<string, number>();
    for (const r of pfRows) {
      const pfCash = cashSar * (r.weightTotal / platformWeight);
      r.goalWeights.forEach((w, gid) => {
        goalCash.set(gid, (goalCash.get(gid) ?? 0) + pfCash * (w / r.weightTotal));
      });
    }

    goalCash.forEach((amountSar, goalId) => {
      if (!(amountSar > 0)) return;
      const list = byGoal.get(goalId) ?? [];
      const existing = list.find((s) => s.accountId === platformId);
      if (existing) existing.amountSar += amountSar;
      else list.push({ accountId: platformId, accountName, amountSar });
      byGoal.set(goalId, list);
    });
  }

  return byGoal;
}

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
    const book = resolveInvestmentPortfolioCurrency(p as InvestmentPortfolio);
    // Match Goals card: each lot resolves to `holding.goalId ?? portfolio.goalId` (never assign the whole book to the portfolio goal while ignoring per-lot links).
    holdings.forEach((h: { goalId?: string; currentValue?: number }) => {
      const gid = h.goalId ?? p.goalId;
      if (!gid) return;
      add(gid, toSAR(h.currentValue ?? 0, book, sarPerUsd));
    });
  });

  const liabilities = ((data as { personalLiabilities?: Liability[] }).personalLiabilities ?? data.liabilities ?? []) as Liability[];
  liabilities.forEach((l) => {
    const gid = l.goalId;
    if (!gid) return;
    const v = receivableContributionForGoal(l, gid);
    if (v > 0) add(gid, v);
  });

  getPersonalSukukPositions(data)
    .filter((p: SukukPosition) => p.goalId && p.status === 'active')
    .forEach((p: SukukPosition) => {
      const outstanding = Math.max(0, Number(p.outstandingPrincipal) || 0);
      if (outstanding > 0) add(String(p.goalId), toSAR(outstanding, p.currency === 'USD' ? 'USD' : 'SAR', sarPerUsd));
    });

  // Idle broker / platform cash on goal-linked portfolios (once per Investment account).
  computeGoalPlatformCashByGoalSar(data, sarPerUsd).forEach((slices, goalId) => {
    slices.forEach((s) => add(goalId, s.amountSar));
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
