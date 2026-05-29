/**
 * Detect expense transactions that dominate Plan YTD (e.g. mis-keyed −451k rows).
 * Used for validation warnings and drill-down to Transactions.
 */

import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';
import {
  financialMonthColumnIndexForDate,
  resolveMonthStartDayFromData,
  transactionDateInFinancialPlanYear,
} from '../utils/financialMonth';
import { toSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import type { Account, FinancialData } from '../types';

export type PlanExpenseOutlier = {
  transactionId: string;
  date: string;
  category: string;
  amountSar: number;
  monthIndex: number;
  monthLabel: string;
  description: string;
  /** Share of absolute YTD expense actuals (0–1). */
  shareOfYtdExpenses: number;
};

const DEFAULT_MIN_SAR = 50_000;
const DOMINANCE_SHARE = 0.35;

function monthLabelForIndex(year: number, monthIndex: number, monthStartDay: number): string {
  if (monthStartDay === 1) {
    return new Date(year, monthIndex, 1).toLocaleString('default', { month: 'short' });
  }
  return `M${monthIndex + 1}`;
}

/**
 * Flag large or dominant expense lines in the selected plan year.
 */
export function detectPlanExpenseOutliers(args: {
  data: FinancialData | null | undefined;
  year: number;
  monthStartDay?: number;
  sarPerUsd?: number;
  exchangeRate?: number;
  minAmountSar?: number;
}): PlanExpenseOutlier[] {
  const { data, year } = args;
  const monthStartDay = args.monthStartDay ?? resolveMonthStartDayFromData(data);
  const rate = Number(args.sarPerUsd ?? args.exchangeRate);
  const sarPerUsd = Number.isFinite(rate) && rate > 0 ? rate : 3.75;
  const minAmountSar = args.minAmountSar ?? DEFAULT_MIN_SAR;

  const accounts =
    getPersonalAccounts(data) as Account[];
  const accountsById = new Map(accounts.map((a) => [String(a.id ?? ''), a]));
  const txAmountSar = (t: { amount?: number; accountId?: string; account_id?: string }) => {
    const acc = accountsById.get(String(t.accountId ?? t.account_id ?? ''));
    const cur = acc?.currency === 'USD' ? 'USD' : 'SAR';
    return toSAR(Math.abs(Number(t.amount) || 0), cur, sarPerUsd);
  };

  const txs = getPersonalTransactions(data) as Array<{
      id?: string;
      date: string;
      type?: string;
      status?: string;
      amount?: number;
      category?: string;
      budgetCategory?: string;
      description?: string;
      accountId?: string;
      account_id?: string;
    }>;

  type Row = PlanExpenseOutlier & { absSar: number };
  const rows: Row[] = [];
  let ytdExpenseAbs = 0;

  txs.forEach((t) => {
    if (!countsAsExpenseForCashflowKpi(t)) return;
    if ((t.status ?? 'Approved') !== 'Approved') return;
    if (!transactionDateInFinancialPlanYear(t.date, year, monthStartDay)) return;

    const allocations = getTransactionBudgetAllocations(t as never);
    allocations.forEach((allocation) => {
      const amountSar = txAmountSar({ ...t, amount: allocation.amount });
      if (!(amountSar > 0)) return;
      ytdExpenseAbs += amountSar;
      const monthIndex = financialMonthColumnIndexForDate(t.date, year, monthStartDay);
      if (monthIndex == null || monthIndex < 0 || monthIndex > 11) return;
      rows.push({
        transactionId: String(t.id ?? `${t.date}-${allocation.category}-${amountSar}`),
        date: t.date,
        category: allocation.category,
        amountSar,
        absSar: amountSar,
        monthIndex,
        monthLabel: monthLabelForIndex(year, monthIndex, monthStartDay),
        description: String(t.description ?? '').trim() || allocation.category,
        shareOfYtdExpenses: 0,
      });
    });
  });

  if (ytdExpenseAbs <= 0) return [];

  const withShare = rows.map((r) => ({
    ...r,
    shareOfYtdExpenses: r.absSar / ytdExpenseAbs,
  }));

  return withShare
    .filter((r) => r.absSar >= minAmountSar || r.shareOfYtdExpenses >= DOMINANCE_SHARE)
    .sort((a, b) => b.absSar - a.absSar)
    .slice(0, 12)
    .map(({ absSar: _a, ...rest }) => rest);
}

export function planExpenseOutlierPageAction(
  year: number,
  monthIndex: number,
  category: string,
): string {
  return `filter-plan-expense:${year}:${monthIndex + 1}:${encodeURIComponent(category)}`;
}
