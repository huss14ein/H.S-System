import type { Transaction } from '../types';
import { getTransactionBudgetAllocations } from '../services/transactionBudgetAllocations';
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

/** Owner (admin) sees the full ledger; collaborators see only mapped shared/permitted budget spend. */
export type TransactionLedgerVisibilityScope = {
  mode: 'owner' | 'collaborator';
  allowedBudgetCategories?: string[];
  governanceReady?: boolean;
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

function transactionMatchesBudgetCategory(t: Transaction, category: string): boolean {
  if (category === 'all') return true;
  const allocations = getTransactionBudgetAllocations(t);
  if (allocations.length > 0) {
    return allocations.some((line) => line.category === category);
  }
  return txBudgetLabel(t) === category;
}

function isVisibleForCollaborator(t: Transaction, allowedBudgetCategories: string[]): boolean {
  if (allowedBudgetCategories.length === 0) return false;
  if (t.type !== 'expense') return true;
  const allocations = getTransactionBudgetAllocations(t);
  if (allocations.length === 0) return false;
  return allocations.some((line) => allowedBudgetCategories.includes(line.category));
}

function passesVisibilityScope(
  t: Transaction,
  scope: TransactionLedgerVisibilityScope | undefined,
): boolean {
  if (!scope || scope.mode === 'owner') return true;
  if (!scope.governanceReady) return false;
  return isVisibleForCollaborator(t, scope.allowedBudgetCategories ?? []);
}

/**
 * UI ledger filters — calendar month (`type="month"`), account, nature, type, budget category.
 * Collaborator visibility is applied here; budget-permission rules for create/edit stay on save paths.
 */
export function filterTransactionsForLedgerView(
  transactions: Transaction[],
  filters: TransactionLedgerFilters,
  _monthStartDay?: number,
  visibilityScope?: TransactionLedgerVisibilityScope,
): Transaction[] {
  const monthIso = filters.month.trim() || currentCalendarMonthIso();
  const calendarRange = calendarMonthRangeFromIsoKey(monthIso);

  return transactions.filter((t) => {
    if (!passesVisibilityScope(t, visibilityScope)) return false;

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
    const isBudgetMatch = transactionMatchesBudgetCategory(t, filters.budgetCategory);
    return isMonthMatch && isAccountMatch && isNatureMatch && isExpenseTypeMatch && isBudgetMatch;
  });
}

/** Parse `filter-by-budget:…` page actions (category may be URI-encoded). */
export function parseFilterByBudgetPageAction(action: string): {
  category: string;
  period: string;
  year: number;
  month: number;
} | null {
  if (!action.startsWith('filter-by-budget:')) return null;
  const rest = action.slice('filter-by-budget:'.length);
  const match = rest.match(/^(.+):(monthly|weekly|daily|yearly):(\d{4}):([1-9]|1[0-2])$/i);
  if (!match) return null;
  const period = match[2].toLowerCase();
  const year = Number(match[3]);
  const month = Number(match[4]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  let category = match[1];
  try {
    category = decodeURIComponent(category);
  } catch {
    /* keep raw */
  }
  return { category, period, year, month };
}

/** CSV export — same visibility + UI filters as the list, with an explicit date/account window. */
export function filterTransactionsForLedgerExport(
  transactions: Transaction[],
  filters: TransactionLedgerFilters,
  opts: {
    dateFrom: Date;
    dateTo: Date;
    accountId: string;
    visibilityScope?: TransactionLedgerVisibilityScope;
  },
  monthStartDay?: number,
): Transaction[] {
  const listFiltered = filterTransactionsForLedgerView(
    transactions,
    { ...filters, allMonths: true },
    monthStartDay,
    opts.visibilityScope,
  );
  return listFiltered.filter((t) => {
    const inPeriod = dateInRange(t.date, opts.dateFrom, opts.dateTo);
    const isAccountMatch =
      opts.accountId === 'all' || resolveTransactionAccountId(t) === opts.accountId;
    return inPeriod && isAccountMatch;
  });
}
