import type { Transaction } from '../types';
import {
  calendarMonthRangeFromIsoKey,
  currentCalendarMonthIso,
  dateInRange,
} from './financialMonth';
import { resolveTransactionAccountId } from './wealthScope';

export type TransactionLedgerFilters = {
  accountId: string;
  month: string;
  allMonths: boolean;
  nature: 'all' | 'Fixed' | 'Variable';
  expenseType: 'all' | 'Core' | 'Discretionary';
  budgetCategory: 'all' | string;
};

function txBudgetLabel(t: Transaction): string {
  return String(t.budgetCategory ?? t.category ?? '').trim();
}

function normalizeNature(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeExpenseType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * UI ledger filters only — does not apply budget-permission governance (that gates create/edit, not viewing).
 * Month picker (`YYYY-MM`) is treated as **calendar month** (HTML `type="month"` semantics), not fiscal month.
 */
export function filterTransactionsForLedgerView(
  transactions: Transaction[],
  filters: TransactionLedgerFilters,
  _monthStartDay?: number,
): Transaction[] {
  const monthIso = filters.month.trim() || currentCalendarMonthIso();
  const calendarRange = calendarMonthRangeFromIsoKey(monthIso);

  return transactions.filter((t) => {
    const isMonthMatch =
      filters.allMonths ||
      (calendarRange != null && dateInRange(t.date, calendarRange.start, calendarRange.end));
    const isAccountMatch =
      filters.accountId === 'all' || resolveTransactionAccountId(t) === filters.accountId;
    const txNature = normalizeNature(t.transactionNature);
    const isNatureMatch =
      filters.nature === 'all' || txNature === normalizeNature(filters.nature);
    const txExpenseType = normalizeExpenseType(t.expenseType);
    const isExpenseTypeMatch =
      filters.expenseType === 'all' ||
      t.type !== 'expense' ||
      txExpenseType === normalizeExpenseType(filters.expenseType);
    const txBudget = txBudgetLabel(t);
    const isBudgetMatch = filters.budgetCategory === 'all' || txBudget === filters.budgetCategory;
    return isMonthMatch && isAccountMatch && isNatureMatch && isExpenseTypeMatch && isBudgetMatch;
  });
}
