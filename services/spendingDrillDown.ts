import type { FinancialData, Page } from '../types';
import { currentFinancialMonthIso, resolveMonthStartDayFromData } from '../utils/financialMonth';

export type SpendingDrillDownArgs = {
  budgetCategory: string;
  monthKey?: string;
  accountId?: string;
  nature?: 'Fixed' | 'Variable';
  data?: FinancialData | null;
  period?: 'monthly' | 'weekly' | 'daily' | 'yearly';
  year?: number;
  month?: number;
  anchorDate?: string;
};

/** Build Transactions page action for budget drill-down (full filter-by-budget contract). */
export function buildBudgetDrillDownAction(args: SpendingDrillDownArgs): string {
  const cat = encodeURIComponent(args.budgetCategory.trim());
  const ref = new Date();
  const monthStartDay = resolveMonthStartDayFromData(args.data ?? null);
  const finIso = args.monthKey ?? currentFinancialMonthIso(ref, monthStartDay);
  const [yStr, mStr] = finIso.split('-');
  const year = args.year ?? (Number(yStr) || ref.getFullYear());
  const month = args.month ?? (Number(mStr) || ref.getMonth() + 1);
  const period = args.period ?? 'monthly';
  const anchor = args.anchorDate ?? ref.toISOString().slice(0, 10);
  return `filter-by-budget:${cat}:${period}:${year}:${month}:${anchor}`;
}

export function buildFiscalMonthDrillDownAction(monthKey: string): string {
  return `filter-by-month:${encodeURIComponent(monthKey)}`;
}

export function buildMerchantDrillDownAction(merchant: string): string {
  return `filter-by-merchant:${encodeURIComponent(merchant.trim())}`;
}

function categoryFromBudgetAction(action: string): string | null {
  if (!action.startsWith('filter-by-budget:')) return null;
  const rest = action.slice('filter-by-budget:'.length);
  const cat = rest.split(':')[0];
  if (!cat) return null;
  try {
    return decodeURIComponent(cat);
  } catch {
    return cat;
  }
}

export function triggerSpendingDrillDown(
  triggerPageAction: ((page: Page, action: string) => void) | undefined,
  setActivePage: ((page: Page) => void) | undefined,
  action: string,
  options?: { setSelectedCategory?: (category: string | null) => void },
): void {
  const cat = categoryFromBudgetAction(action);
  if (cat && options?.setSelectedCategory) {
    options.setSelectedCategory(cat);
  }
  if (triggerPageAction) {
    triggerPageAction('Transactions', action);
    return;
  }
  if (setActivePage) setActivePage('Transactions');
}
