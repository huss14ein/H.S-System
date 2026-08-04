import {
  budgetsForFinancialMonthView,
  type FinancialMonthKey,
} from './financialMonth';

export type BudgetCardCategorySource = {
  category: string;
  year: number;
  month: number;
  period?: string | null;
  limit?: number;
};

export type BudgetCardCategoryOptionsArgs = {
  budgets: BudgetCardCategorySource[];
  viewKey: FinancialMonthKey;
  monthStartDay: unknown;
  /** When Admin, all own scoped cards are included. Restricted filters to permitted ∪ shared. */
  userRole?: 'Admin' | 'Restricted' | string;
  permittedCategories?: string[];
  /** Categories shown as shared budget cards (collaborator envelopes). */
  sharedCategories?: string[];
  /** Finalized NewCategory request names that appear as Budgets page cards. */
  finalizedNewCategoryNames?: string[];
};

/**
 * Category names that appear as Budgets page cards for a financial month.
 * Transaction "Map to Budget" and related pickers must use this list only —
 * never all historical `data.budgets` rows across months.
 */
export function budgetCardCategoryNames(args: BudgetCardCategoryOptionsArgs): string[] {
  const {
    budgets,
    viewKey,
    monthStartDay,
    userRole = 'Admin',
    permittedCategories = [],
    sharedCategories = [],
    finalizedNewCategoryNames = [],
  } = args;

  const isAdmin = userRole === 'Admin';
  const permitted = permittedCategories.map((c) => String(c || '').trim()).filter(Boolean);
  const shared = sharedCategories.map((c) => String(c || '').trim()).filter(Boolean);
  const finalized = finalizedNewCategoryNames.map((c) => String(c || '').trim()).filter(Boolean);

  const ownScoped = budgetsForFinancialMonthView(budgets, viewKey, monthStartDay).filter((b) => {
    const cat = String(b.category || '').trim();
    if (!cat) return false;
    if (isAdmin) return true;
    if (permitted.length === 0 && shared.length === 0) return true;
    return permitted.includes(cat) || shared.includes(cat);
  });

  const names = new Set<string>();
  for (const b of ownScoped) {
    names.add(String(b.category).trim());
  }

  // Restricted synthetic cards: permitted categories with no own budget row still show on Budgets.
  if (!isAdmin) {
    for (const cat of permitted) {
      names.add(cat);
    }
  }

  for (const cat of shared) {
    names.add(cat);
  }

  for (const cat of finalized) {
    if (isAdmin || permitted.includes(cat) || shared.includes(cat) || permitted.length === 0) {
      names.add(cat);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** Keep a selected budget category only if it is still on the card list. */
export function coerceBudgetCategorySelection(
  selected: string | null | undefined,
  cardCategories: string[],
  fallbackToFirst = true,
): string {
  const value = String(selected || '').trim();
  if (value && cardCategories.includes(value)) return value;
  return fallbackToFirst ? cardCategories[0] || '' : '';
}

/** Exact match first; avoid loose substring matches (e.g. "Wife" → "Wife and Kids Allowance"). */
export function matchBudgetCardCategory(suggested: string, cardCategories: string[]): string | null {
  const needle = String(suggested || '').trim();
  if (!needle || cardCategories.length === 0) return null;
  if (cardCategories.includes(needle)) return needle;
  const lower = needle.toLowerCase();
  const exactIgnoreCase = cardCategories.find((c) => c.toLowerCase() === lower);
  if (exactIgnoreCase) return exactIgnoreCase;
  return null;
}
