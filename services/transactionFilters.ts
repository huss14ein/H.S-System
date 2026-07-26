/**
 * Internal moves between your accounts (and cash↔brokerage legs that use the same categories).
 * `addTransfer` uses "Transfer"; recurring + some flows use "Transfers" — treat both as internal
 * so Income/Expenses/Net Flow on Transactions are not inflated by money that never left your world.
 */
import { isReconciliationLedgerCategory } from './reconciliation/constants';
import { isRewardsLedgerCategory } from './rewards/rewardsDomain';

export function isInternalTransferTransaction(t: {
  category?: string;
  type?: string;
}): boolean {
  const c = String(t.category ?? '').trim().toLowerCase();
  return c === 'transfer' || c === 'transfers';
}

function normalizedTxType(t: { type?: string }): string {
  return String(t.type ?? '').trim().toLowerCase();
}

/** Ledger rows that adjust book balances without representing income/expense/savings cashflow. */
export function isExcludedFromCashflowKpis(t: { category?: string; type?: string }): boolean {
  return (
    isReconciliationLedgerCategory(t.category) ||
    isRewardsLedgerCategory(t.category) ||
    isInternalTransferTransaction(t)
  );
}

export function countsAsExpenseForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  /** Card/loan payments recorded as `debt_payment` are not “spending” for budget/cashflow KPIs. */
  if (normalizedTxType(t) === 'debt_payment') return false;
  if (isReconciliationLedgerCategory(t.category)) return false;
  if (isRewardsLedgerCategory(t.category)) return false;
  return normalizedTxType(t) === 'expense' && !isInternalTransferTransaction(t);
}

/** Income with category Transfer/Transfers is treated as an internal move, not earned cashflow. */
export function countsAsIncomeForCashflowKpi(t: {
  type?: string;
  category?: string;
}): boolean {
  if (isReconciliationLedgerCategory(t.category)) return false;
  if (isRewardsLedgerCategory(t.category)) return false;
  return normalizedTxType(t) === 'income' && !isInternalTransferTransaction(t);
}
