import type { FinancialData } from '../types';
import {
  computePersonalHeadlineNetWorthSar,
  type PersonalHeadlineNetWorthResult,
} from './personalNetWorth';
import { sumPersonalSukukPositionsSar } from './sukuk/sukukExposure';
import { bucketSumMatchesNetWorth } from './netWorthReconciliation';
import { totalLiquidCashSARFromAccounts } from '../utils/currencyMath';
import { debtStressScore } from './debtEngines';
import { normalizedMonthlyExpenseSar, cashRunwayMonths } from './financeMetrics';
import { getPersonalAccounts, getPersonalTransactions, getPersonalLiabilities } from '../utils/wealthScope';
import type { NetWorthSnapshot } from './netWorthSnapshot';
import { NW_BUCKETS_SCHEMA_V2, pushNetWorthSnapshot, type NetWorthSyncContext } from './netWorthSnapshot';

export type ExtendedSnapshotMeta = {
  runwayMonths?: number;
  goalProgressPct?: number;
  debtStressScore?: number;
  riskScore?: number;
  allocationPct?: { cash: number; investments: number; debt: number };
};

export function buildNetWorthSnapshotFromHeadline(
  headline: PersonalHeadlineNetWorthResult,
  data: FinancialData,
): NetWorthSnapshot {
  const buckets = headline.buckets;
  const sukukAudit = sumPersonalSukukPositionsSar(data);
  return {
    at: new Date().toISOString(),
    netWorth: headline.netWorth,
    sarPerUsd: headline.sarPerUsd,
    bucketsSchemaVersion: NW_BUCKETS_SCHEMA_V2,
    buckets: {
      cash: buckets.cash,
      investments: buckets.investments,
      physicalAndCommodities: buckets.physicalAndCommodities,
      receivables: buckets.receivables,
      liabilities: buckets.liabilities,
      ...(sukukAudit > 0 ? { sukukSar: sukukAudit } : {}),
    },
  };
}

/** Persist snapshot from the same headline object shown on Dashboard / Summary KPIs. */
export function captureNetWorthSnapshotFromHeadline(
  headline: PersonalHeadlineNetWorthResult,
  data: FinancialData,
  sync?: NetWorthSyncContext | null,
): NetWorthSnapshot | null {
  const snap = buildNetWorthSnapshotFromHeadline(headline, data);
  const balance = bucketSumMatchesNetWorth(snap);
  if (!balance.matches) {
    if (import.meta.env.DEV) {
      console.warn(
        `[Finova NW snapshot] Rejected capture — bucket drift ${balance.driftSar.toFixed(2)} SAR (components ${balance.componentsSum.toFixed(0)} vs NW ${snap.netWorth.toFixed(0)}).`,
      );
    }
    return null;
  }
  if (!Number.isFinite(snap.netWorth) || snap.netWorth <= 0.5) return null;
  pushNetWorthSnapshot(snap.netWorth, snap.buckets, snap.sarPerUsd, sync);
  return snap;
}

export function buildExtendedNetWorthSnapshot(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
  simulatedPrices?: Record<string, { price: number }>,
): { snap: NetWorthSnapshot; meta: ExtendedSnapshotMeta } {
  const headline = computePersonalHeadlineNetWorthSar(data, uiExchangeRate, {
    getAvailableCashForAccount,
    simulatedPrices,
  });
  const buckets = headline.buckets;
  const accounts = getPersonalAccounts(data);
  const txs = getPersonalTransactions(data);
  const liabilities = getPersonalLiabilities(data);
  const totalDebt = liabilities
    .filter((l) => (l.status ?? 'Active') === 'Active' && (l.amount ?? 0) < 0)
    .reduce((s, l) => s + Math.abs(l.amount ?? 0), 0);
  const liquidCash = totalLiquidCashSARFromAccounts(accounts, getAvailableCashForAccount, headline.sarPerUsd);
  const monthlyExpense = normalizedMonthlyExpenseSar(txs, accounts, uiExchangeRate, { monthsLookback: 6, data });
  const runway = cashRunwayMonths(liquidCash, monthlyExpense);
  const goals = data.goals ?? [];
  const goalProgressPct =
    goals.length > 0
      ? goals.reduce((s, g) => {
          const target = Math.max(0, Number(g.targetAmount) || 0);
          const cur = Math.max(0, Number(g.currentAmount) || 0);
          return s + (target > 0 ? Math.min(1, cur / target) : 0);
        }, 0) / goals.length
      : 0;
  const stress = debtStressScore(totalDebt * 0.02, monthlyExpense > 0 ? monthlyExpense * 2 : 0, liquidCash);
  const nw = headline.netWorth;
  const allocationPct = {
    cash: nw > 0 ? (buckets.cash / nw) * 100 : 0,
    investments: nw > 0 ? (buckets.investments / nw) * 100 : 0,
    debt: nw > 0 ? (Math.abs(buckets.liabilities) / nw) * 100 : 0,
  };
  const meta: ExtendedSnapshotMeta = {
    runwayMonths: runway,
    goalProgressPct: goalProgressPct * 100,
    debtStressScore: stress.score,
    riskScore: stress.score,
    allocationPct,
  };
  const snap = buildNetWorthSnapshotFromHeadline(headline, data);
  const balance = bucketSumMatchesNetWorth(snap);
  if (!balance.matches && import.meta.env.DEV) {
    console.warn(
      `[Finova NW snapshot] Bucket sum drift ${balance.driftSar.toFixed(2)} SAR at capture (components ${balance.componentsSum.toFixed(0)} vs NW ${nw.toFixed(0)}).`,
    );
  }
  return { snap, meta };
}

export function captureExtendedNetWorthSnapshot(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
  sync?: NetWorthSyncContext | null,
  simulatedPrices?: Record<string, { price: number }>,
): NetWorthSnapshot | null {
  const { snap } = buildExtendedNetWorthSnapshot(data, uiExchangeRate, getAvailableCashForAccount, simulatedPrices);
  const balance = bucketSumMatchesNetWorth(snap);
  if (!balance.matches || !Number.isFinite(snap.netWorth) || snap.netWorth <= 0.5) return null;
  pushNetWorthSnapshot(snap.netWorth, snap.buckets, snap.sarPerUsd, sync);
  return snap;
}

/** Alias — same canonical capture used by Summary, Command palette, and auto snapshot. */
export const captureCanonicalNetWorthSnapshot = captureExtendedNetWorthSnapshot;
