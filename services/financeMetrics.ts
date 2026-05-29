import type { Account, FinancialData, Transaction } from '../types';
import {
  countsAsExpenseForCashflowKpi,
  countsAsIncomeForCashflowKpi,
  isInternalTransferTransaction,
} from './transactionFilters';
import { toSAR, resolveSarPerUsd } from '../utils/currencyMath';
import {
  addMonthsToKey,
  financialMonthKey,
  financialMonthRange,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { hydrateSarPerUsdDailySeries, getSarPerUsdForCalendarDay } from './fxDailySeries';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';

export type TxLike = {
  date: string;
  type?: string;
  category?: string;
  amount?: number;
};

const ISO_CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toLocalCalendarDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTransactionCalendarDay(rawDate: string): string | null {
  const dayPrefix = (rawDate ?? '').slice(0, 10);
  if (ISO_CALENDAR_DAY_RE.test(dayPrefix)) return dayPrefix;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalCalendarDay(parsed);
}

/**
 * Average monthly external (non-transfer) expenses over months that have data in the lookback window.
 */
export function normalizedMonthlyExpense(
  transactions: TxLike[],
  opts?: { monthsLookback?: number; endDate?: Date }
): number {
  const monthsLookback = opts?.monthsLookback ?? 6;
  const now = opts?.endDate ?? new Date();
  const end = opts?.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const start = new Date(now.getFullYear(), now.getMonth() - monthsLookback, 1);
  const startDay = toLocalCalendarDay(start);
  const endDay = toLocalCalendarDay(end);
  const byMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
    const day = toTransactionCalendarDay(t.date);
    if (!day || day < startDay || day > endDay) return;
    const key = day.slice(0, 7);
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
  const now = opts?.endDate ?? new Date();
  const end = opts?.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const start = new Date(now.getFullYear(), now.getMonth() - monthsLookback, 1);
  const startDay = toLocalCalendarDay(start);
  const endDay = toLocalCalendarDay(end);
  const byMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
    const day = toTransactionCalendarDay(t.date);
    if (!day || day < startDay || day > endDay) return;
    const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
    const key = day.slice(0, 7);
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

/**
 * Net cash flow for the **financial month** containing `ref` (respects Settings → month start day).
 */
export function netCashFlowForFinancialMonthSarDated(
  transactions: Transaction[],
  accounts: Account[],
  ref: Date,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): { income: number; expenses: number; net: number } {
  hydrateSarPerUsdDailySeries(data ?? null, uiExchangeRate);
  const spot = resolveSarPerUsd(data ?? null, uiExchangeRate);
  const monthStartDay = resolveMonthStartDayFromData(data ?? null);
  const { start, end } = financialMonthRange(ref, monthStartDay);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const curOf = (accountId: string): 'SAR' | 'USD' => (accById.get(accountId)?.currency === 'USD' ? 'USD' : 'SAR');
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime()) || d < start || d > end) continue;
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

/** Savings rate for the financial month containing `ref`. */
export function savingsRateSarFinancialMonth(
  transactions: Transaction[],
  accounts: Account[],
  ref: Date,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): number {
  const { income, expenses } = netCashFlowForFinancialMonthSarDated(
    transactions,
    accounts,
    ref,
    data,
    uiExchangeRate,
  );
  if (income <= 0) return 0;
  return Math.max(0, Math.min(100, ((income - expenses) / income) * 100));
}

/** Investable surplus: max(0, net cash flow) for the month (simplified). */
export function investableSurplus(transactions: TxLike[], ref: Date = new Date()): number {
  return Math.max(0, netCashFlowForMonth(transactions, ref).net);
}

/**
 * Last `monthsBack` **financial** months of personal-scope net cash flow (income − expenses) in SAR.
 * Keys are `YYYY-MM` where MM is the financial month number (aligned with Budgets).
 */
export function personalMonthlyNetByMonthKeySar(
  data: FinancialData,
  uiExchangeRate: number,
  monthsBack = 12
): { monthKeys: string[]; values: number[]; byKey: Map<string, number> } {
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data) as Account[];
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const monthStartDay = resolveMonthStartDayFromData(data);
  const now = new Date();
  const { key: currentKey } = financialMonthRange(now, monthStartDay);
  const byKey = new Map<string, number>();
  const keys: FinancialMonthKey[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const k = addMonthsToKey(currentKey, -i);
    const label = `${k.year}-${String(k.month).padStart(2, '0')}`;
    keys.push(k);
    byKey.set(label, 0);
  }
  for (const t of transactions) {
    if (!t.date) continue;
    const fk = financialMonthKey(new Date(t.date), monthStartDay);
    const label = `${fk.year}-${String(fk.month).padStart(2, '0')}`;
    if (!byKey.has(label)) continue;
    const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
    const day = t.date.slice(0, 10);
    const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
    const amt = toSAR(Math.abs(Number(t.amount) || 0), cur, r);
    let delta = 0;
    if (countsAsIncomeForCashflowKpi(t)) delta += amt;
    else if (countsAsExpenseForCashflowKpi(t)) delta -= amt;
    else continue;
    byKey.set(label, (byKey.get(label) || 0) + delta);
  }
  const monthKeys = keys.map((k) => `${k.year}-${String(k.month).padStart(2, '0')}`);
  const values = monthKeys.map((k) => byKey.get(k) || 0);
  return { monthKeys, values, byKey };
}

/**
 * Last `monthsBack` **financial** months of inflow / outflow in SAR (same filters + FX as {@link personalMonthlyNetByMonthKeySar}).
 */
export function personalMonthlyInflowOutflowByFinancialMonthSar(
  data: FinancialData,
  uiExchangeRate: number,
  monthsBack = 12,
): { monthKeys: string[]; inflow: number[]; outflow: number[]; net: number[]; byKey: Map<string, { inflow: number; outflow: number; net: number }> } {
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const transactions = getPersonalTransactions(data);
  const accounts = getPersonalAccounts(data) as Account[];
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const monthStartDay = resolveMonthStartDayFromData(data);
  const now = new Date();
  const { key: currentKey } = financialMonthRange(now, monthStartDay);
  const byKey = new Map<string, { inflow: number; outflow: number; net: number }>();
  const keys: FinancialMonthKey[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const k = addMonthsToKey(currentKey, -i);
    const label = `${k.year}-${String(k.month).padStart(2, '0')}`;
    keys.push(k);
    byKey.set(label, { inflow: 0, outflow: 0, net: 0 });
  }
  for (const t of transactions) {
    if (!t.date || isInternalTransferTransaction(t)) continue;
    const fk = financialMonthKey(new Date(t.date), monthStartDay);
    const label = `${fk.year}-${String(fk.month).padStart(2, '0')}`;
    const row = byKey.get(label);
    if (!row) continue;
    const cur = accById.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
    const day = t.date.slice(0, 10);
    const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
    const amt = toSAR(Math.abs(Number(t.amount) || 0), cur, r);
    if (countsAsIncomeForCashflowKpi(t)) {
      row.inflow += amt;
      row.net += amt;
    } else if (countsAsExpenseForCashflowKpi(t)) {
      row.outflow += amt;
      row.net -= amt;
    }
  }
  const monthKeys = keys.map((k) => `${k.year}-${String(k.month).padStart(2, '0')}`);
  const inflow = monthKeys.map((k) => byKey.get(k)?.inflow ?? 0);
  const outflow = monthKeys.map((k) => byKey.get(k)?.outflow ?? 0);
  const net = monthKeys.map((k) => byKey.get(k)?.net ?? 0);
  return { monthKeys, inflow, outflow, net, byKey };
}
