import type { FinancialData } from '../types';
import { computePersonalHeadlineNetWorthSar } from './personalNetWorth';
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
  const monthlyExpense = normalizedMonthlyExpenseSar(txs, accounts, uiExchangeRate, { monthsLookback: 6 });
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
  const snap: NetWorthSnapshot = {
    at: new Date().toISOString(),
    netWorth: nw,
    sarPerUsd: headline.sarPerUsd,
    bucketsSchemaVersion: NW_BUCKETS_SCHEMA_V2,
    buckets: {
      cash: buckets.cash,
      investments: buckets.investments,
      physicalAndCommodities: buckets.physicalAndCommodities,
      receivables: buckets.receivables,
      liabilities: buckets.liabilities,
    },
  };
  return { snap, meta };
}

export function captureExtendedNetWorthSnapshot(
  data: FinancialData,
  uiExchangeRate: number,
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
  sync?: NetWorthSyncContext | null,
  simulatedPrices?: Record<string, { price: number }>,
): NetWorthSnapshot {
  const { snap } = buildExtendedNetWorthSnapshot(data, uiExchangeRate, getAvailableCashForAccount, simulatedPrices);
  pushNetWorthSnapshot(snap.netWorth, snap.buckets, snap.sarPerUsd, sync);
  return snap;
}
