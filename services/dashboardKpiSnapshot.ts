import type { Account, FinancialData, Transaction } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { savingsRateSar } from './financeMetrics';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from './fxDailySeries';
import { computePersonalNetWorthSAR } from './personalNetWorth';
import { computePersonalInvestmentKpiBreakdown, type InvestmentCapitalSource } from './investmentKpiCore';

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
): DashboardKpiSnapshot | null {
  try {
    if (!data) return null;
    hydrateSarPerUsdDailySeries(data, exchangeRate);
    const sarPerUsd = resolveSarPerUsd(data, exchangeRate);

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

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

    const monthlyTransactions = transactions.filter((t) => new Date(t.date) >= firstDayOfMonth);
    const monthlyIncome = monthlyTransactions
      .filter((t) => countsAsIncomeForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const monthlyExpenses = monthlyTransactions
      .filter((t) => countsAsExpenseForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const monthlyPnL = monthlyIncome - monthlyExpenses;

    const budgetToMonthly = (b: { limit: number; period?: string }) =>
      b.period === 'yearly' ? b.limit / 12 : b.period === 'weekly' ? b.limit * (52 / 12) : b.period === 'daily' ? b.limit * (365 / 12) : b.limit;
    const currentMonthBudgets = (data.budgets ?? []).filter((b) => b.month === now.getMonth() + 1 && b.year === now.getFullYear());
    const totalBudget = currentMonthBudgets.reduce((sum, b) => sum + budgetToMonthly(b), 0);
    const budgetVariance = totalBudget - monthlyExpenses;

    const lastMonthTransactions = transactions.filter((t) => {
      const date = new Date(t.date);
      return date >= firstDayOfLastMonth && date < firstDayOfMonth;
    });
    const lastMonthIncome = lastMonthTransactions
      .filter((t) => countsAsIncomeForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const lastMonthExpenses = lastMonthTransactions
      .filter((t) => countsAsExpenseForCashflowKpi(t))
      .reduce((sum, t) => sum + txCashflowSar(t), 0);
    const lastMonthPnL = lastMonthIncome - lastMonthExpenses;

    const netWorth = computePersonalNetWorthSAR(data, sarPerUsd, {
        getAvailableCashForAccount: getAvailableCashForAccount as (id: string) => { SAR: number; USD: number },
    });
    const netWorthPrevMonth = netWorth - monthlyPnL;
    const netWorthTrend = netWorthPrevMonth !== 0 ? ((netWorth - netWorthPrevMonth) / netWorthPrevMonth) * 100 : 0;

    const invBreakdown = computePersonalInvestmentKpiBreakdown(data, sarPerUsd, getAvailableCashForAccount);
    const { roi, capitalSource: investmentCapitalSource } = invBreakdown;

    const pnlTrend =
      lastMonthPnL !== 0 ? ((monthlyPnL - lastMonthPnL) / Math.abs(lastMonthPnL)) * 100 : monthlyPnL > 0 ? 100 : 0;

    const sixMoStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const incomeLast6Mo = transactions.filter(
      (t) => countsAsIncomeForCashflowKpi(t) && new Date(t.date) >= sixMoStart,
    );
    const incomeSumSar6Mo = incomeLast6Mo.reduce((s, t) => s + txCashflowSar(t), 0);
    const avgMonthlyIncomeSar6Mo = incomeLast6Mo.length > 0 ? incomeSumSar6Mo / 6 : 0;

    const todayKey = now.toISOString().slice(0, 10);
    const fxToday = getSarPerUsdForCalendarDay(todayKey, data, exchangeRate);
    let liquidCashSar = 0;
    for (const a of accounts) {
      if (!['Checking', 'Savings'].includes(a.type ?? '')) continue;
      const bal = Math.max(0, Number(a.balance) || 0);
      if (a.currency === 'USD') {
        liquidCashSar += toSAR(bal, 'USD', fxToday);
      } else {
        liquidCashSar += bal;
      }
    }

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

/** Average SAR-based savings rate over the last `months` calendar months (including current). */
export function averageSavingsRateSarRolling(
  transactions: Transaction[],
  accounts: Account[],
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
  months: number = 3,
): number {
  if (!transactions.length || months < 1) return 0;
  hydrateSarPerUsdDailySeries(data ?? null, uiExchangeRate);
  const sar = resolveSarPerUsd(data ?? null, uiExchangeRate);
  const now = new Date();
  let sum = 0;
  let n = 0;
  for (let i = 0; i < months; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 15);
    sum += savingsRateSar(transactions, accounts, ref, sar);
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
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

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
