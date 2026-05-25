import type { Budget } from '../types';
import {
  budgetAppliesToFinancialView,
  budgetRowViewMatchScore,
  type BudgetViewPeriod,
  type FinancialMonthKey,
} from '../utils/financialMonth';

export function normalizeSharedOwnerKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeSharedCategoryKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function makeSharedOwnerCategoryKey(owner: unknown, category: unknown): string {
  return `${normalizeSharedOwnerKey(owner)}::${normalizeSharedCategoryKey(category)}`;
}

/** Valid plan year from persistence (1+). Null = not stored / unspecified. */
export function parseStoredBudgetYear(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

/** Valid calendar/financial month index from persistence (1–12). Null = not stored / unspecified. */
export function parseStoredBudgetMonth(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return Math.round(n);
}

export type SharedBudgetLike = Budget & {
  owner_user_id?: string;
  ownerEmail?: string;
  owner_email?: string;
  shared_at?: string;
  /** True when RPC/DB had no valid year — period matching uses the active financial view at read time. */
  budgetYearUnspecified?: boolean;
  /** True when RPC/DB had no valid month — period matching uses the active financial view at read time. */
  budgetMonthUnspecified?: boolean;
};

export function isBudgetYearUnspecified(row: {
  year?: unknown;
  budgetYearUnspecified?: boolean;
}): boolean {
  if (row.budgetYearUnspecified === true) return true;
  if (row.budgetYearUnspecified === false) return false;
  return parseStoredBudgetYear(row.year) == null;
}

export function isBudgetMonthUnspecified(row: {
  month?: unknown;
  budgetMonthUnspecified?: boolean;
}): boolean {
  if (row.budgetMonthUnspecified === true) return true;
  if (row.budgetMonthUnspecified === false) return false;
  return parseStoredBudgetMonth(row.month) == null;
}

/** Normalize a shared-budget RPC row: explicit flags + placeholder 0 only for required Budget fields. */
export function normalizeSharedBudgetRowFromRpc<T extends Record<string, unknown>>(row: T): SharedBudgetLike & T {
  const year = parseStoredBudgetYear(row.year);
  const month = parseStoredBudgetMonth(row.month);
  return {
    ...row,
    period: (row.period as string | undefined) ?? 'monthly',
    year: year ?? 0,
    month: month ?? 0,
    budgetYearUnspecified: year == null,
    budgetMonthUnspecified: month == null,
    tier: (row.tier as Budget['tier']) ?? (row.budget_tier as Budget['tier']) ?? 'Optional',
    ownerEmail: (row.owner_email as string) || (row.owner_user_id as string) || (row.user_id as string),
    owner_user_id: (row.owner_user_id as string) || (row.user_id as string),
  } as SharedBudgetLike & T;
}

export function resolveBudgetYearMonthForView(
  row: Pick<SharedBudgetLike, 'year' | 'month' | 'budgetYearUnspecified' | 'budgetMonthUnspecified'>,
  viewKey: FinancialMonthKey,
): { year: number; month: number } {
  return {
    year: isBudgetYearUnspecified(row) ? viewKey.year : Number(row.year),
    month: isBudgetMonthUnspecified(row) ? viewKey.month : Number(row.month),
  };
}

function dedupePeriodKeyPart(
  unspecified: boolean,
  value: number,
): string {
  return unspecified ? '*' : String(value);
}

/**
 * Prevent duplicate shared budget rows when overlapping share scopes exist
 * (e.g. repeated ALL shares or ALL + specific rows returning the same budget).
 */
export function dedupeSharedBudgetRows<T extends SharedBudgetLike>(rows: T[]): T[] {
  const bestByKey = new Map<string, T>();
  rows.forEach((row) => {
    const owner = row.owner_user_id ?? row.user_id ?? row.ownerEmail ?? row.owner_email ?? '';
    const key = `${makeSharedOwnerCategoryKey(owner, row.category)}::${dedupePeriodKeyPart(
      isBudgetYearUnspecified(row),
      row.year,
    )}::${dedupePeriodKeyPart(isBudgetMonthUnspecified(row), row.month)}::${String(row.period || 'monthly').trim().toLowerCase()}`;
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, row);
      return;
    }
    const prevTs = new Date((prev as SharedBudgetLike).shared_at ?? 0).getTime();
    const nextTs = new Date((row as SharedBudgetLike).shared_at ?? 0).getTime();
    if (nextTs >= prevTs) bestByKey.set(key, row);
  });
  return Array.from(bestByKey.values());
}

/** One shared card per owner + category for the active financial view (same rule as own budgets). */
export function dedupeSharedBudgetRowsForFinancialView<T extends SharedBudgetLike>(
  rows: T[],
  viewKey: FinancialMonthKey,
  monthStartDay: unknown,
  budgetView: BudgetViewPeriod,
): T[] {
  const byOwnerCategory = new Map<string, T[]>();
  for (const b of rows) {
    const { year, month } = resolveBudgetYearMonthForView(b, viewKey);
    if (
      !budgetAppliesToFinancialView(
        { year, month, period: b.period },
        viewKey,
        monthStartDay,
        budgetView,
      )
    ) {
      continue;
    }
    const owner = b.owner_user_id ?? b.user_id ?? b.ownerEmail ?? b.owner_email ?? '';
    const key = makeSharedOwnerCategoryKey(owner, b.category);
    const list = byOwnerCategory.get(key) ?? [];
    list.push(b);
    byOwnerCategory.set(key, list);
  }

  const out: T[] = [];
  for (const group of byOwnerCategory.values()) {
    let best = group[0];
    const bestResolved = resolveBudgetYearMonthForView(best, viewKey);
    let bestScore = budgetRowViewMatchScore(
      { year: bestResolved.year, month: bestResolved.month, period: best.period },
      viewKey,
      monthStartDay,
    );
    for (let i = 1; i < group.length; i++) {
      const candidate = group[i];
      const resolved = resolveBudgetYearMonthForView(candidate, viewKey);
      const score = budgetRowViewMatchScore(
        { year: resolved.year, month: resolved.month, period: candidate.period },
        viewKey,
        monthStartDay,
      );
      if (
        score > bestScore ||
        (score === bestScore && Number(candidate.limit) > Number(best.limit))
      ) {
        best = candidate;
        bestScore = score;
      }
    }
    if (bestScore >= 0) out.push(best);
  }
  return out;
}

/** Include row in plan-year shared list (unspecified year = visible in every plan year). */
export function sharedBudgetRowInPlanYear(
  row: Pick<SharedBudgetLike, 'year' | 'budgetYearUnspecified'>,
  planYear: number,
): boolean {
  if (isBudgetYearUnspecified(row)) return true;
  return Number(row.year) === planYear;
}
