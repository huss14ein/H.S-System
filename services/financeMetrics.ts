import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';

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
  const now = opts?.endDate ?? new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsLookback, 1);
  const byMonth = new Map<string, number>();
  transactions.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
    const d = new Date(t.date);
    if (d < start || d > now) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(Number(t.amount) || 0));
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

/** Investable surplus: max(0, net cash flow) for the month (simplified). */
export function investableSurplus(transactions: TxLike[], ref: Date = new Date()): number {
  return Math.max(0, netCashFlowForMonth(transactions, ref).net);
}
