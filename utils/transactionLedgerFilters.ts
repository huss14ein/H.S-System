import type { Transaction } from '../types';
import { getTransactionBudgetAllocations } from '../services/transactionBudgetAllocations';
import {
  calendarMonthRangeFromIsoKey,
  currentCalendarMonthIso,
  dateInRange,
  financialMonthRangeFromKey,
} from './financialMonth';
import { resolveTransactionAccountId } from './wealthScope';
import { computeBudgetSpendWindows, type BudgetViewMode } from '../services/budgetViewSpendWindows';

export type TransactionLedgerFilters = {
  accountId: string;
  month: string;
  allMonths: boolean;
  /** Calendar month (month picker) vs fiscal month (budget card drill-down). */
  monthMode?: 'calendar' | 'fiscal';
  /** Weekly/daily/yearly budget drill-down — exact window from Budgets cards. */
  dateRangeOverride?: { start: Date; end: Date };
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

function collaboratorCategoryLabels(t: Transaction): string[] {
  const allocations = getTransactionBudgetAllocations(t);
  if (allocations.length > 0) {
    return allocations.map((line) => line.category);
  }
  const label = txBudgetLabel(t);
  return label ? [label] : [];
}

function isVisibleForCollaborator(t: Transaction, allowedBudgetCategories: string[]): boolean {
  if (allowedBudgetCategories.length === 0) return false;
  if (t.type !== 'expense') return true;
  const labels = collaboratorCategoryLabels(t);
  if (labels.length === 0) return false;
  return labels.some((label) => allowedBudgetCategories.includes(label));
}

function passesVisibilityScope(
  t: Transaction,
  scope: TransactionLedgerVisibilityScope | undefined,
): boolean {
  if (!scope || scope.mode === 'owner') return true;
  if (!scope.governanceReady) return true;
  return isVisibleForCollaborator(t, scope.allowedBudgetCategories ?? []);
}

function monthRangeForFilters(
  filters: TransactionLedgerFilters,
  monthStartDay: number,
): { start: Date; end: Date } | null {
  const monthIso = filters.month.trim() || currentCalendarMonthIso();
  if (filters.monthMode === 'fiscal') {
    const [year, month] = monthIso.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return financialMonthRangeFromKey({ year, month }, monthStartDay);
  }
  return calendarMonthRangeFromIsoKey(monthIso);
}

/** Visible list + default export bounds for the active ledger filters. */
export function ledgerDateRangeForFilters(
  filters: TransactionLedgerFilters,
  monthStartDay: number,
): { start: Date; end: Date } | null {
  if (filters.allMonths) return null;
  if (filters.dateRangeOverride) return filters.dateRangeOverride;
  return monthRangeForFilters(filters, monthStartDay);
}

export function formatLedgerDateYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Same spend window as Budgets card click (monthly fiscal / weekly / daily / yearly). */
export function budgetDrillDownDateRange(
  parsed: { period: string; year: number; month: number; anchorDate?: string },
  monthStartDay: number,
): { start: Date; end: Date } {
  const view: BudgetViewMode =
    parsed.period === 'weekly'
      ? 'Weekly'
      : parsed.period === 'daily'
        ? 'Daily'
        : parsed.period === 'yearly'
          ? 'Yearly'
          : 'Monthly';
  const anchor = parsed.anchorDate
    ? new Date(`${parsed.anchorDate}T12:00:00`)
    : new Date();
  const { rangeStart, rangeEnd } = computeBudgetSpendWindows({
    budgetView: view,
    currentYear: parsed.year,
    currentMonth: parsed.month,
    monthStartDay,
    anchorDate: anchor,
  });
  return { start: rangeStart, end: rangeEnd };
}

/**
 * UI ledger filters — account, nature, type, budget category.
 * Month picker uses calendar months; budget drill-down uses fiscal months when monthMode=fiscal.
 */
export function filterTransactionsForLedgerView(
  transactions: Transaction[],
  filters: TransactionLedgerFilters,
  monthStartDay = 1,
  visibilityScope?: TransactionLedgerVisibilityScope,
): Transaction[] {
  const monthRange = ledgerDateRangeForFilters(filters, monthStartDay);

  return transactions.filter((t) => {
    if (!passesVisibilityScope(t, visibilityScope)) return false;

    const isMonthMatch =
      filters.allMonths ||
      (monthRange != null && dateInRange(t.date, monthRange.start, monthRange.end));
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

/** Parse `filter-by-budget:…` page actions (category may be URI-encoded). Optional anchor YYYY-MM-DD. */
export function parseFilterByBudgetPageAction(action: string): {
  category: string;
  period: string;
  year: number;
  month: number;
  anchorDate?: string;
} | null {
  if (!action.startsWith('filter-by-budget:')) return null;
  const rest = action.slice('filter-by-budget:'.length);
  const match = rest.match(/^(.+):(monthly|weekly|daily|yearly):(\d{4}):([1-9]|1[0-2])(?::(\d{4}-\d{2}-\d{2}))?$/i);
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
  const anchorDate = match[5];
  return { category, period, year, month, ...(anchorDate ? { anchorDate } : {}) };
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
