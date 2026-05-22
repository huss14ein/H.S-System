import type { Account, FinancialData, Transaction } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { savingsRateSarFinancialMonth } from './financeMetrics';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { toSAR, totalLiquidCashSARFromAccounts } from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from './fxDailySeries';
import { computePersonalHeadlineNetWorthSar } from './personalNetWorth';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  type InvestmentCapitalSource,
} from './investmentKpiCore';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import {
  addMonthsToKey,
  effectiveMonthStartDate,
  financialMonthRange,
  financialMonthRangeFromKey,
  type FinancialMonthKey,
} from '../utils/financialMonth';

/**
 * Net worth trend on Dashboard / Summary cards: this month's P&L vs implied net worth at financial month start.
 * Shared so both surfaces show the same percent (not portfolio TWR).
 */
export function computeImpliedFinancialMonthNetWorthTrendPct(
  netWorthSar: number,
  monthlyPnLSar: number,
): number {
  const impliedMonthStart = netWorthSar - monthlyPnLSar;
  if (!Number.isFinite(impliedMonthStart) || Math.abs(impliedMonthStart) < 1e-9) return 0;
  return (monthlyPnLSar / Math.abs(impliedMonthStart)) * 100;
}

export type FinancialMonthCashflowSar = {
  monthlyIncomeSar: number;
  monthlyExpensesSar: number;
  monthlyPnLSar: number;
  currentRange: ReturnType<typeof financialMonthRange>;
};

/**
 * Current financial month income, expenses, and P&amp;L in SAR (transaction-dated FX for USD lines).
 * Single path shared with `computeWealthSummaryReportModel` so Summary matches Dashboard KPIs.
 */
export function financialMonthNetCashflowSar(
  data: FinancialData,
  uiExchangeRate: number,
): FinancialMonthCashflowSar {
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const now = new Date();
  const monthStartDay = (data as any)?.settings?.monthStartDay ?? 1;
  const currentRange = financialMonthRange(now, monthStartDay);
  const d = data as FinancialData & { personalTransactions?: Transaction[]; personalAccounts?: Account[] };
  const transactions = (d.personalTransactions ?? data.transactions ?? []) as Transaction[];
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const txCashflowSar = (t: { accountId?: string; amount?: number; date: string }) => {
    const acc = accountsById.get(t.accountId ?? '') as Account | undefined;
    const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
    const raw = Math.abs(Number(t.amount) || 0);
    if (c === 'SAR') return raw;
    const day = t.date.slice(0, 10);
    const r = getSarPerUsdForCalendarDay(day, data, uiExchangeRate);
    return toSAR(raw, 'USD', r);
  };

  const monthlyTransactions = transactions.filter((t) => {
    const dt = new Date(t.date);
    return dt >= currentRange.start && dt <= currentRange.end;
  });
  const monthlyIncomeSar = monthlyTransactions
    .filter((t) => countsAsIncomeForCashflowKpi(t))
    .reduce((sum, t) => sum + txCashflowSar(t), 0);
  const monthlyExpensesSar = monthlyTransactions
    .filter((t) => countsAsExpenseForCashflowKpi(t))
    .reduce((sum, t) => sum + txCashflowSar(t), 0);

  return {
    monthlyIncomeSar,
    monthlyExpensesSar,
    monthlyPnLSar: monthlyIncomeSar - monthlyExpensesSar,
    currentRange,
  };
}

/** KPI figures shared by Dashboard and System Health diagnostics (keep in sync with dashboard aggregation). */
export type DashboardKpiSnapshot = {
  netWorth: number;
  monthlyPnL: number;
  budgetVariance: number;
  roi: number;
  netWorthTrend: number;
  pnlTrend: number;
  /** Checking + Savings, non-negative, converted to SAR (matches KPI cashflow conventions). */
  liquidCashSar: number;
  /** Sum of income (SAR) over the last ~6 months ÷ 6; 0 if no income in window. */
  avgMonthlyIncomeSar6Mo: number;
  /** How ROI net-capital denominator was chosen (`investmentKpiCore`). */
  investmentCapitalSource: InvestmentCapitalSource;
};

export function computeDashboardKpiSnapshot(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  getAvailableCashForAccount: (accountId: string) => { SAR?: number; USD?: number } | null | undefined,
  simulatedPrices: SimulatedPriceMap = {},
): DashboardKpiSnapshot | null {
  try {
    if (!data) return null;
    hydrateSarPerUsdDailySeries(data, exchangeRate);
    const headline = computePersonalHeadlineNetWorthSar(data, exchangeRate, {
      getAvailableCashForAccount: getAvailableCashForAccount as (id: string) => { SAR: number; USD: number },
      simulatedPrices,
    });
    const sarPerUsd = headline.sarPerUsd;

    const cf = financialMonthNetCashflowSar(data, exchangeRate);
    const { monthlyExpensesSar: monthlyExpenses, monthlyPnLSar: monthlyPnL, currentRange } = cf;
    const monthStartDay = (data as any)?.settings?.monthStartDay ?? 1;
    const prevKey: FinancialMonthKey = addMonthsToKey(currentRange.key, -1);
    /** Use `financialMonthRangeFromKey` — do not derive the period via `financialMonthRange(midCalendarDay)`; when `monthStartDay > 15`, a mid-month reference falls before the period start and maps to the wrong financial month. */
    const prevRange = financialMonthRangeFromKey(prevKey, monthStartDay);

    const d = data as FinancialData & { personalTransactions?: Transaction[]; personalAccounts?: Account[] };
    const transactions = (d.personalTransactions ?? data.transactions ?? []) as Transaction[];
    const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
    const accountsById = new Map(accounts.map((a) => [a.id, a]));

    const txCashflowSar = (t: { accountId?: string; amount?: number; date: string }) => {
      const acc = accountsById.get(t.accountId ?? '') as Account | undefined;
      const c = acc?.currency === 'USD' ? 'USD' : 'SAR';
      const raw = Math.abs(Number(t.amount) || 0);
      if (c === 'SAR') return raw;
      const day = t.date.slice(0, 10);
      const r = getSarPerUsdForCalendarDay(day, data, exchangeRate);
      return toSAR(raw, 'USD', r);
    };

    const budgetToMonthly = (b: { limit: number; period?: string }) =>
      b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
    const currentMonthBudgets = (data.budgets ?? []).filter((b) => b.month === currentRange.key.month && b.year === currentRange.key.year);
    const totalBudget = currentMonthBudgets.reduce((sum, b) => sum + budgetToMonthly(b), 0);
    const budgetVariance = totalBudget - monthlyExpenses;

    const lastMonthTransactions = transactions.filter((t) => {
      const d = new Date(t.date);
      return d >= prevRange.start && d <= prevRange.end;
    });
    const lastMonthIncome = lastMonthTransactions
      .filter((t) => countsAsIncomeForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const lastMonthExpenses = lastMonthTransactions
      .filter((t) => countsAsExpenseForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const lastMonthPnL = lastMonthIncome - lastMonthExpenses;

    const netWorth = headline.netWorth;
    const netWorthTrend = computeImpliedFinancialMonthNetWorthTrendPct(netWorth, monthlyPnL);

    const headlineInv = computeHeadlinePersonalInvestmentRoiDecimal(
      data,
      sarPerUsd,
      getAvailableCashForAccount as (id: string) => { SAR: number; USD: number },
      simulatedPrices,
    );
    const { roi, capitalSource: investmentCapitalSource } = headlineInv;

    const pnlTrend =
      lastMonthPnL !== 0 ? ((monthlyPnL - lastMonthPnL) / Math.abs(lastMonthPnL)) * 100 : monthlyPnL > 0 ? 100 : 0;

    const startKey = addMonthsToKey(currentRange.key, -6);
    const sixMoStart = effectiveMonthStartDate(startKey.year, startKey.month, monthStartDay);
    const incomeLast6Mo = transactions.filter(
      (t) => countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= sixMoStart,
    );
    const incomeSumSar6Mo = incomeLast6Mo.reduce((s, t) => s + txCashflowSar(t), 0);
    const avgMonthlyIncomeSar6Mo = incomeLast6Mo.length > 0 ? incomeSumSar6Mo / 6 : 0;

    const liquidCashSar = totalLiquidCashSARFromAccounts(
      accounts as Account[],
      getAvailableCashForAccount as (id: string) => { SAR: number; USD: number },
      sarPerUsd,
    );

    return {
      netWorth,
      monthlyPnL,
      budgetVariance,
      roi,
      netWorthTrend,
      pnlTrend,
      liquidCashSar,
      avgMonthlyIncomeSar6Mo,
      investmentCapitalSource,
    };
  } catch (e) {
    console.error('computeDashboardKpiSnapshot:', e);
    return null;
  }
}

/** Average SAR-based savings rate over the last `months` financial months (including current). */
export function averageSavingsRateSarRolling(
  transactions: Transaction[],
  accounts: Account[],
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
  months: number = 3,
): number {
  if (!transactions.length || months < 1 || !data) return 0;
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const monthStartDay = resolveMonthStartDayFromData(data);
  const now = new Date();
  const { key: currentKey } = financialMonthRange(now, monthStartDay);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < months; i++) {
    const k = addMonthsToKey(currentKey, -i);
    const { start, end } = financialMonthRangeFromKey(k, monthStartDay);
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    sum += savingsRateSarFinancialMonth(transactions, accounts, mid, data, uiExchangeRate);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Data-quality warnings for dashboard / system health (same rules as legacy Dashboard). */
export function computeDashboardValidationWarnings(
  data: FinancialData | null | undefined,
  kpi: DashboardKpiSnapshot | null,
): string[] {
  const warnings: string[] = [];
  if (!data) return warnings;
  const d = data as FinancialData & { personalTransactions?: Transaction[]; personalAccounts?: Account[] };
  const txs = (d.personalTransactions ?? data.transactions ?? []) as Transaction[];
  const budgets = data.budgets ?? [];
  const accounts = (d.personalAccounts ?? data.accounts ?? []) as Account[];
  const now = new Date();
  const monthStartDay = (data as any)?.settings?.monthStartDay ?? 1;
  const { key } = financialMonthRange(now, monthStartDay);
  const month = key.month;
  const year = key.year;

  if (!kpi || !Number.isFinite(kpi.netWorth)) warnings.push('Net worth calculation returned an invalid number.');
  if (!kpi || !Number.isFinite(kpi.monthlyPnL)) warnings.push("This month's P&L is invalid.");
  if (!kpi || !Number.isFinite(kpi.budgetVariance)) warnings.push('Budget variance is invalid.');
  if (!kpi || !Number.isFinite(kpi.roi)) warnings.push('Investment ROI is invalid.');

  const uncategorizedExpenseCount = txs.filter(
    (t) => countsAsExpenseForCashflowKpi(t) && !String((t as Transaction & { budgetCategory?: string }).budgetCategory ?? '').trim(),
  ).length;
  if (uncategorizedExpenseCount > 0) warnings.push(`${uncategorizedExpenseCount} expense transaction(s) are uncategorized.`);

  const currentMonthBudgetCount = budgets.filter((b) => b.month === month && b.year === year).length;
  if (currentMonthBudgetCount === 0 && txs.length > 0) warnings.push('No budgets found for the current month.');

  const negativeCashAccounts = accounts.filter((a) => (a.type === 'Checking' || a.type === 'Savings') && (Number(a.balance) || 0) < 0).length;
  if (negativeCashAccounts > 0) warnings.push(`${negativeCashAccounts} cash account(s) have negative balances.`);

  return warnings;
}
