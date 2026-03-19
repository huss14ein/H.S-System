import type { Transaction } from '../types';
import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';

/** Net external cashflow between two dates (excludes internal transfers). */
export function personalNetCashflowBetween(
  transactions: Transaction[],
  startIso: string,
  endIso: string
): number {
  const t0 = new Date(startIso).getTime();
  const t1 = new Date(endIso).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;
  let net = 0;
  transactions.forEach((t) => {
    const ts = new Date(t.date).getTime();
    if (ts < t0 || ts > t1) return;
    if (countsAsIncomeForCashflowKpi(t)) net += Number(t.amount) || 0;
    if (countsAsExpenseForCashflowKpi(t)) net -= Math.abs(Number(t.amount) || 0);
  });
  return net;
}
