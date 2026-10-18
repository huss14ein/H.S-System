/**
 * Shared gate: do not treat a lumpy month as "over budget" when the annual envelope
 * (or yearly-period cap) still has headroom — e.g. Housing Rent paid twice a year.
 */

import type { Budget, Transaction, Account } from '../types';
import {
  annualEnvelopeLimitForCategory,
  monthlyEquivalentStoredLimit,
} from './budgetEnvelopeMath';
import { aggregatePersonalBudgetCategorySpendSar } from './budgetSpendMath';
import {
  budgetsForFinancialMonthView,
  financialMonthKey,
  financialMonthRangeFromKey,
  type FinancialMonthKey,
} from '../utils/financialMonth';

export type BudgetHeadroomMode = 'monthly' | 'annual';

export type BudgetCategoryHeadroom = {
  category: string;
  mode: BudgetHeadroomMode;
  /** Cap used for overspend decisions (monthly limit or annual envelope). */
  limitSar: number;
  /** Spend against that cap (month or YTD). */
  spentSar: number;
  remainingSar: number;
  utilizationPct: number;
  /** True when governing envelope is annual. */
  hasAnnualEnvelope: boolean;
  annualLimitSar: number;
  monthSpentSar: number;
  /** Soft info: month is hot vs monthly-eq but annual still OK. */
  lumpyMonthWithinAnnual: boolean;
  /** YTD (+ upcoming) / annualLimit — 0 when no annual envelope. */
  annualUtilizationPct: number;
};

const EPS = 0.0001;

export function planYearForFinancialKey(finKey: FinancialMonthKey): number {
  return Number(finKey.year) || new Date().getFullYear();
}

/** YTD range for a financial-month key (plan year Jan 1 → end of this financial month). */
export function ytdRangeForFinancialMonth(
  finKey: FinancialMonthKey,
  monthStartDay: unknown,
): { start: Date; end: Date } {
  const year = planYearForFinancialKey(finKey);
  const { end } = financialMonthRangeFromKey(finKey, monthStartDay);
  return { start: new Date(year, 0, 1), end };
}

/**
 * Resolve which envelope to use for overspend / confirm warnings.
 * Yearly-period rows and categories with an annual envelope use YTD vs annual cap.
 */
export function resolveBudgetCategoryHeadroom(args: {
  category: string;
  finKey: FinancialMonthKey;
  monthStartDay: unknown;
  budgets: Budget[];
  monthSpentSar: number;
  ytdSpentSar: number;
  upcomingSar?: number;
}): BudgetCategoryHeadroom {
  const category = String(args.category || '').trim();
  const year = planYearForFinancialKey(args.finKey);
  const rows = budgetsForFinancialMonthView(args.budgets, args.finKey, args.monthStartDay).filter(
    (b) => b.category === category,
  );
  // Prefer a yearly-period row for this category in the plan year (not only the current
  // financial-month view) so bi-annual rent still uses the annual gate every month.
  const yearlyRow =
    rows.find((b) => b.period === 'yearly') ??
    args.budgets.find(
      (b) =>
        String(b.category || '').trim() === category &&
        Number(b.year) === year &&
        b.period === 'yearly',
    );
  const monthlyEq = rows.reduce((s, b) => s + monthlyEquivalentStoredLimit(b), 0);
  // Only treat as an annual *plan* envelope when a yearly-period row exists.
  // Do not use extrapolated ×12 from a single monthly row — that would silence
  // legitimate monthly overspend (e.g. Travel) every month.
  const annualLimitSar = yearlyRow
    ? Math.max(
        Number(yearlyRow.limit) || 0,
        annualEnvelopeLimitForCategory(category, year, args.budgets, args.monthStartDay),
      )
    : 0;

  // Yearly-period categories always use YTD vs yearly cap (rent twice/year, etc.).
  const effectiveMode: BudgetHeadroomMode = yearlyRow ? 'annual' : 'monthly';
  const limitSar = effectiveMode === 'annual' ? annualLimitSar : monthlyEq;

  const spentSar = effectiveMode === 'annual' ? args.ytdSpentSar : args.monthSpentSar;
  const upcoming = Math.max(0, Number(args.upcomingSar) || 0);
  const projected = spentSar + upcoming;
  const remainingSar = limitSar - spentSar;
  const utilizationPct = limitSar > EPS ? (projected / limitSar) * 100 : 0;
  const monthVsMonthlyEq = monthlyEq > EPS ? (args.monthSpentSar + upcoming) / monthlyEq : 0;
  const annualProjected = args.ytdSpentSar + upcoming;
  const annualUtilizationPct =
    annualLimitSar > EPS ? (annualProjected / annualLimitSar) * 100 : 0;
  const withinAnnual =
    annualLimitSar > EPS ? annualProjected <= annualLimitSar + EPS : true;
  const lumpyMonthWithinAnnual =
    Boolean(yearlyRow) && monthVsMonthlyEq > 1.05 && withinAnnual;

  return {
    category,
    mode: effectiveMode,
    limitSar,
    spentSar,
    remainingSar,
    utilizationPct,
    hasAnnualEnvelope: Boolean(yearlyRow) && annualLimitSar > EPS,
    annualLimitSar,
    monthSpentSar: args.monthSpentSar,
    lumpyMonthWithinAnnual,
    annualUtilizationPct,
  };
}

/**
 * True when we should emit shared overspend / Critical warnings.
 * Annual envelope (when present) is the plan budget: no warning while YTD is within it,
 * even if the current month exceeds the monthly-equivalent (e.g. rent twice/year).
 */
export function shouldWarnBudgetOverspend(
  headroom: Pick<
    BudgetCategoryHeadroom,
    'limitSar' | 'utilizationPct' | 'hasAnnualEnvelope' | 'annualUtilizationPct'
  >,
  thresholdPct = 100,
): boolean {
  if (headroom.hasAnnualEnvelope) {
    return headroom.annualUtilizationPct > thresholdPct + EPS;
  }
  if (!(headroom.limitSar > EPS)) return false;
  return headroom.utilizationPct > thresholdPct + EPS;
}

/** Status for analysis / notifications against the governing envelope. */
export function statusFromAnnualAwareUtilization(
  utilizationPct: number,
  hasLimit: boolean,
  opts?: { watchPct?: number; criticalPct?: number },
): 'healthy' | 'watch' | 'critical' | 'over' | 'no_budget' {
  if (!hasLimit) return 'no_budget';
  if (utilizationPct > 100 + EPS) return 'over';
  const criticalPct = opts?.criticalPct ?? 100;
  const watchPct = opts?.watchPct ?? 85;
  if (utilizationPct >= criticalPct) return 'critical';
  if (utilizationPct >= watchPct) return 'watch';
  return 'healthy';
}

/** Build month + YTD spend maps for personal budget categories (SAR). */
export function buildMonthAndYtdSpendMaps(args: {
  transactions: Transaction[];
  accounts: Account[];
  finKey: FinancialMonthKey;
  monthStartDay: unknown;
  data: unknown;
  sarPerUsd: number;
  excludeTransactionId?: string;
}): { monthSpent: Map<string, number>; ytdSpent: Map<string, number> } {
  const { start: monthStart, end: monthEnd } = financialMonthRangeFromKey(
    args.finKey,
    args.monthStartDay,
  );
  const { start: ytdStart, end: ytdEnd } = ytdRangeForFinancialMonth(args.finKey, args.monthStartDay);
  const currencyById = new Map(
    args.accounts.map((a) => [String(a.id), (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD']),
  );
  const txs = args.excludeTransactionId
    ? args.transactions.filter((t) => String(t.id) !== String(args.excludeTransactionId))
    : args.transactions;

  const monthSpent = aggregatePersonalBudgetCategorySpendSar(
    txs,
    monthStart,
    monthEnd,
    currencyById,
    args.data as any,
    args.sarPerUsd,
  );
  const ytdSpent = aggregatePersonalBudgetCategorySpendSar(
    txs,
    ytdStart,
    ytdEnd,
    currencyById,
    args.data as any,
    args.sarPerUsd,
  );
  return { monthSpent, ytdSpent };
}

export function headroomFromSpendMaps(
  category: string,
  finKey: FinancialMonthKey,
  monthStartDay: unknown,
  budgets: Budget[],
  monthSpent: Map<string, number>,
  ytdSpent: Map<string, number>,
  upcomingSar = 0,
): BudgetCategoryHeadroom {
  return resolveBudgetCategoryHeadroom({
    category,
    finKey,
    monthStartDay,
    budgets,
    monthSpentSar: monthSpent.get(category) ?? 0,
    ytdSpentSar: ytdSpent.get(category) ?? 0,
    upcomingSar,
  });
}

/**
 * Lumpy yearly categories (e.g. rent twice/year) inflate month expense totals vs monthly-eq caps.
 * While YTD is still within the yearly plan, strip that month excess so KPI / digest variance
 * does not read as "Over budget".
 */
export function lumpyYearlyMonthExcessWithinPlanSar(args: {
  budgets: Budget[];
  finKey: FinancialMonthKey;
  monthStartDay: unknown;
  monthSpentByCat: Map<string, number>;
  ytdSpentByCat: Map<string, number>;
}): number {
  const cats = new Set<string>();
  for (const c of args.monthSpentByCat.keys()) {
    const t = String(c || '').trim();
    if (t) cats.add(t);
  }
  for (const b of args.budgets ?? []) {
    if (b.period !== 'yearly') continue;
    const t = String(b.category || '').trim();
    if (t) cats.add(t);
  }
  let excess = 0;
  for (const category of cats) {
    const monthSpent = args.monthSpentByCat.get(category) ?? 0;
    const ytdSpent = args.ytdSpentByCat.get(category) ?? 0;
    const headroom = resolveBudgetCategoryHeadroom({
      category,
      finKey: args.finKey,
      monthStartDay: args.monthStartDay,
      budgets: args.budgets,
      monthSpentSar: monthSpent,
      ytdSpentSar: ytdSpent,
    });
    if (!headroom.hasAnnualEnvelope || headroom.annualUtilizationPct > 100 + EPS) continue;
    const monthEq =
      headroom.annualLimitSar > EPS ? headroom.annualLimitSar / 12 : 0;
    excess += Math.max(0, monthSpent - monthEq);
  }
  return excess;
}

/** Month expenses for budget-variance KPIs after yearly-plan headroom adjustment. */
export function adjustMonthExpensesForYearlyPlanHeadroom(
  monthExpensesSar: number,
  args: Parameters<typeof lumpyYearlyMonthExcessWithinPlanSar>[0],
): number {
  const excess = lumpyYearlyMonthExcessWithinPlanSar(args);
  return Math.max(0, monthExpensesSar - excess);
}

export { financialMonthKey };
