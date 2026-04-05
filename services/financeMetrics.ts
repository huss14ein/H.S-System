import type { Account, FinancialData, Transaction } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import { getSarPerUsdForCalendarDay } from './fxDailySeries';

export type TxLike = {
  date: string;
  type?: string;
  category?: string;
  amount?: number;
};

/**
 * Average monthly external (non-transfer) expenses over months that have data in the lookback window.
 */
export function normalizedMonthlyExpense(
  transactions: TxLike[],
  opts?: { monthsLookback?: number; endDate?: Date }
): number {
  const monthsLookback = opts?.monthsLookback ?? 6;
  const end = opts?.endDate ?? new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - monthsLookback, 1);
  const byMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
    const d = new Date(t.date);
    if (d < start || d > end) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(Number(t.amount) || 0));
  });
  if (byMonth.size === 0) return 0;
  return Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size;
}

/**
 * Like {@link normalizedMonthlyExpense} but each expense is converted to **SAR** using the owning cash account currency.
 */
export function normalizedMonthlyExpenseSar(
  transactions: Transaction[],
  accounts: Account[],
  sarPerUsd: number,
  opts?: { monthsLookback?: number; endDate?: Date }
): number {
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const monthsLookback = opts?.monthsLookback ?? 6;
  const end = opts?.endDate ?? new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - monthsLookback, 1);
  const byMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
    const d = new Date(t.date);
    if (d < start || d > end) return;
    const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + toSAR(Math.abs(Number(t.amount) || 0), cur, sarPerUsd));
  });
  if (byMonth.size === 0) return 0;
  return Array.from(byMonth.values()).reduce((a, b) => a + b, 0) / byMonth.size;
}

export function cashRunwayMonths(liquidCash: number, avgMonthlyExpense: number): number {
  if (avgMonthlyExpense <= 0) return liquidCash > 0 ? 99 : 0;
  return liquidCash / avgMonthlyExpense;
}

/** Net external cash flow for the calendar month of `ref` (default: current month). */
export function netCashFlowForMonth(
  transactions: TxLike[],
  ref: Date = new Date()
): { income: number; expenses: number; net: number } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const inMonth = transactions.filter((t) => {
    const d = new Date(t.date);
    return d.getFullYear() === y && d.getMonth() === m;
  });
  const income = inMonth.filter((t) => countsAsIncomeForCashflowKpi(t)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const expenses = inMonth
    .filter((t) => countsAsExpenseForCashflowKpi(t))
    .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  return { income, expenses, net: income - expenses };
}

/**
 * Same as {@link netCashFlowForMonth} but converts each transaction to **SAR** using the account's cash currency
 * (Checking/Savings `currency`) and `sarPerUsd` (SAR per 1 USD).
 */
export function netCashFlowForMonthSar(
  transactions: Transaction[],
  accounts: Account[],
  ref: Date,
  sarPerUsd: number
): { income: number; expenses: number; net: number } {
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  const y = ref.getFullYear();
  const m = ref.getMonth();
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    const d = new Date(t.date);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    const c = curOf(t.accountId);
    if (countsAsIncomeForCashflowKpi(t)) {
      income += toSAR(Math.max(0, Number(t.amount) || 0), c, sarPerUsd);
    }
    if (countsAsExpenseForCashflowKpi(t)) {
      expenses += toSAR(Math.abs(Number(t.amount) || 0), c, sarPerUsd);
    }
  }
  return { income, expenses, net: income - expenses };
}

/** Like {@link netCashFlowForMonthSar} but uses per-transaction dated SAR/USD (call `hydrateSarPerUsdDailySeries` first). */
export function netCashFlowForMonthSarDated(
  transactions: Transaction[],
  accounts: Account[],
  ref: Date,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): { income: number; expenses: number; net: number } {
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  const y = ref.getFullYear();
  const m = ref.getMonth();
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    const d = new Date(t.date);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    const c = curOf(t.accountId);
    const day = (t.date ?? '').slice(0, 10);
    const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
    if (countsAsIncomeForCashflowKpi(t)) {
      income += toSAR(Math.max(0, Number(t.amount) || 0), c, r);
    }
    if (countsAsExpenseForCashflowKpi(t)) {
      expenses += toSAR(Math.abs(Number(t.amount) || 0), c, r);
    }
  }
  return { income, expenses, net: income - expenses };
}

/** Net cash flow (income - expenses) for the month; alias for net from netCashFlowForMonth. */
export function netCashFlow(transactions: TxLike[], ref: Date = new Date()): number {
  return netCashFlowForMonth(transactions, ref).net;
}

/** Free cash flow: net after essential expenses (simplified = net for now). */
export function freeCashFlow(transactions: TxLike[], ref: Date = new Date()): number {
  return netCashFlowForMonth(transactions, ref).net;
}

/** Savings rate: (income - expenses) / income, 0-100. */
export function savingsRate(transactions: TxLike[], ref: Date = new Date()): number {
  const { income, expenses } = netCashFlowForMonth(transactions, ref);
  if (income <= 0) return 0;
  return Math.max(0, Math.min(100, ((income - expenses) / income) * 100));
}

/** Savings rate using SAR-normalized monthly cash flow. */
export function savingsRateSar(
  transactions: Transaction[],
  accounts: Account[],
  ref: Date,
  sarPerUsd: number
): number {
  const { income, expenses } = netCashFlowForMonthSar(transactions, accounts, ref, sarPerUsd);
  if (income <= 0) return 0;
  return Math.max(0, Math.min(100, ((income - expenses) / income) * 100));
}

/** Investable surplus: max(0, net cash flow) for the month (simplified). */
export function investableSurplus(transactions: TxLike[], ref: Date = new Date()): number {
  return Math.max(0, netCashFlowForMonth(transactions, ref).net);
}
