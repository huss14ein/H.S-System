/**
 * Full expense + budget analysis for the Analysis page — uses transaction metadata,
 * budget envelopes, splits, and financial-month windows (same rules as Budgets / Dashboard KPIs).
 */

import type { Account, Budget, BudgetTier, FinancialData, Transaction } from '../types';
import { aggregatePersonalBudgetCategorySpendSar, expenseAmountSarForBudget } from './budgetSpendMath';
import { monthlyEquivalentStoredLimit } from './budgetEnvelopeMath';
import { utilizationLabelFromPercentage } from './budgetCardMetrics';
import { getTransactionBudgetAllocations } from './transactionBudgetAllocations';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { detectBudgetDrift, type BudgetDriftRow } from './budgetDrift';
import { detectPlanExpenseOutliers } from './planExpenseOutliers';
import {
  addMonthsToKey,
  budgetsForFinancialMonthView,
  dateInRange,
  financialMonthColumnHeaderLabel,
  financialMonthIsoKey,
  financialMonthKeyFromTransactionDate,
  financialMonthKeysEndingAt,
  financialMonthRange,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';

export type ExpenseBudgetStatus = 'healthy' | 'watch' | 'critical' | 'over' | 'no_budget';

export type ExpenseBudgetCategoryRow = {
  category: string;
  spentSar: number;
  limitSar: number;
  remainingSar: number;
  utilizationPct: number;
  status: ExpenseBudgetStatus;
  tier?: BudgetTier;
  transactionCount: number;
  priorMonthSpentSar: number;
  momChangePct: number | null;
};

export type ExpenseDimensionSlice = {
  label: string;
  spentSar: number;
  sharePct: number;
  transactionCount: number;
};

export type ExpenseTransactionHighlight = {
  id: string;
  date: string;
  description: string;
  amountSar: number;
  category: string;
  budgetCategory?: string;
  subcategory?: string;
  expenseType?: string;
  transactionNature?: string;
  accountName: string;
  note?: string;
  isSplit: boolean;
};

export type ExpenseDecisionInsight = {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  category?: string;
  amountSar?: number;
};

export type ExpenseDataQualityRow = {
  code: 'uncategorized' | 'unbudgeted' | 'pending' | 'no_metadata';
  label: string;
  count: number;
  amountSar: number;
};

export type ExpenseMonthTrendPoint = {
  monthKey: string;
  label: string;
  incomeSar: number;
  expenseSar: number;
  netSar: number;
  budgetedSar: number;
};

export type ExpenseBudgetAnalysisModel = {
  periodLabel: string;
  monthStartDay: number;
  summary: {
    incomeSar: number;
    expenseSar: number;
    netSar: number;
    budgetedSar: number;
    budgetVarianceSar: number;
    savingsRatePct: number | null;
    categorizedSharePct: number;
    transactionCount: number;
  };
  categories: ExpenseBudgetCategoryRow[];
  overBudgetCategories: ExpenseBudgetCategoryRow[];
  underBudgetCategories: ExpenseBudgetCategoryRow[];
  byTier: ExpenseDimensionSlice[];
  byExpenseType: ExpenseDimensionSlice[];
  byTransactionNature: ExpenseDimensionSlice[];
  byAccount: ExpenseDimensionSlice[];
  topTransactions: ExpenseTransactionHighlight[];
  monthlyTrend: ExpenseMonthTrendPoint[];
  driftRows: BudgetDriftRow[];
  dataQuality: ExpenseDataQualityRow[];
  insights: ExpenseDecisionInsight[];
};

function statusFromUtilization(pct: number, hasLimit: boolean): ExpenseBudgetStatus {
  if (!hasLimit) return 'no_budget';
  if (pct > 100) return 'over';
  const label = utilizationLabelFromPercentage(pct);
  if (label === 'Critical') return 'critical';
  if (label === 'Watch') return 'watch';
  return 'healthy';
}

function safePctChange(current: number, prior: number): number | null {
  if (!(prior > 0)) return current > 0 ? 100 : null;
  return ((current - prior) / prior) * 100;
}

function buildDimensionSlices(
  map: Map<string, { spent: number; count: number }>,
  total: number,
): ExpenseDimensionSlice[] {
  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      spentSar: v.spent,
      sharePct: total > 0 ? (v.spent / total) * 100 : 0,
      transactionCount: v.count,
    }))
    .filter((x) => x.spentSar > 0)
    .sort((a, b) => b.spentSar - a.spentSar);
}

function budgetLimitsForMonth(
  budgets: Budget[],
  finKey: FinancialMonthKey,
  monthStartDay: number,
): Map<string, { limitSar: number; tier?: BudgetTier }> {
  const out = new Map<string, { limitSar: number; tier?: BudgetTier }>();
  for (const b of budgetsForFinancialMonthView(budgets, finKey, monthStartDay)) {
    const prev = out.get(b.category) ?? { limitSar: 0, tier: undefined };
    prev.limitSar += monthlyEquivalentStoredLimit(b);
    if (b.tier) prev.tier = b.tier;
    out.set(b.category, prev);
  }
  return out;
}

function sumBudgetedSar(budgets: Budget[], finKey: FinancialMonthKey, monthStartDay: number): number {
  let total = 0;
  for (const v of budgetLimitsForMonth(budgets, finKey, monthStartDay).values()) {
    total += v.limitSar;
  }
  return total;
}

/** @internal exported for tests */
export function computeExpenseBudgetAnalysisModel(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  ref = new Date(),
): ExpenseBudgetAnalysisModel | null {
  if (!data) return null;

  const monthStartDay = resolveMonthStartDayFromData(data);
  const msd = Number(monthStartDay) || 1;
  const currentRange = financialMonthRange(ref, monthStartDay);
  const finKey = currentRange.key;
  const prevKey = addMonthsToKey(finKey, -1);
  const prevRange = financialMonthRangeFromKey(prevKey, monthStartDay);

  const transactions = getPersonalTransactions(data) as Transaction[];
  const accounts = getPersonalAccounts(data) as Account[];
  const accountCurrencyById = new Map(accounts.map((a) => [String(a.id), (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD']));
  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name || 'Account']));

  const currentSpend = aggregatePersonalBudgetCategorySpendSar(
    transactions,
    currentRange.start,
    currentRange.end,
    accountCurrencyById,
    data,
    exchangeRate,
  );
  const priorSpend = aggregatePersonalBudgetCategorySpendSar(
    transactions,
    prevRange.start,
    prevRange.end,
    accountCurrencyById,
    data,
    exchangeRate,
  );

  const budgets = data.budgets ?? [];
  const currentLimits = budgetLimitsForMonth(budgets, finKey, msd);
  const budgetedSar = sumBudgetedSar(budgets, finKey, msd);
  const tierByCategory = new Map<string, BudgetTier | undefined>();
  for (const [cat, lim] of currentLimits) tierByCategory.set(cat, lim.tier);

  const allCategories = new Set<string>([...currentSpend.keys(), ...priorSpend.keys(), ...currentLimits.keys()]);

  const categories: ExpenseBudgetCategoryRow[] = [];
  for (const category of allCategories) {
    const spentSar = currentSpend.get(category) ?? 0;
    const priorMonthSpentSar = priorSpend.get(category) ?? 0;
    const lim = currentLimits.get(category);
    const limitSar = lim?.limitSar ?? 0;
    const tier = lim?.tier;
    const utilizationPct = limitSar > 0 ? (spentSar / limitSar) * 100 : spentSar > 0 ? 100 : 0;
    const remainingSar = limitSar > 0 ? limitSar - spentSar : 0;
    categories.push({
      category,
      spentSar,
      limitSar,
      remainingSar,
      utilizationPct,
      status: statusFromUtilization(utilizationPct, limitSar > 0),
      tier,
      transactionCount: 0,
      priorMonthSpentSar,
      momChangePct: safePctChange(spentSar, priorMonthSpentSar),
    });
  }
  categories.sort((a, b) => b.spentSar - a.spentSar);

  const overBudgetCategories = categories.filter((c) => c.status === 'over' || c.status === 'critical');
  const underBudgetCategories = categories
    .filter((c) => c.limitSar > 0 && c.utilizationPct < 85 && c.spentSar > 0)
    .sort((a, b) => b.remainingSar - a.remainingSar);

  let expenseSar = 0;
  let incomeSar = 0;
  const tierMap = new Map<string, { spent: number; count: number }>();
  const expenseTypeMap = new Map<string, { spent: number; count: number }>();
  const natureMap = new Map<string, { spent: number; count: number }>();
  const accountMap = new Map<string, { spent: number; count: number }>();
  const highlights: ExpenseTransactionHighlight[] = [];

  let uncategorizedCount = 0;
  let uncategorizedSar = 0;
  let unbudgetedSar = 0;
  let unbudgetedCount = 0;
  let pendingCount = 0;
  let pendingSar = 0;
  let noMetadataCount = 0;
  let noMetadataSar = 0;
  let categorizedSar = 0;

  const categoryTxCount = new Map<string, number>();

  const budgetedCats = new Set(currentLimits.keys());

  for (const t of transactions) {
    if (!dateInRange(t.date, currentRange.start, currentRange.end)) continue;

    const amtSar = expenseAmountSarForBudget(t, accountCurrencyById, data, exchangeRate);

    if (t.type === 'income' && (t.status ?? 'Approved') === 'Approved') {
      incomeSar += amtSar;
      continue;
    }
    if (!countsAsExpenseForCashflowKpi(t)) continue;

    if ((t.status ?? 'Approved') === 'Pending') {
      pendingCount += 1;
      pendingSar += amtSar;
    }

    expenseSar += amtSar;

    const allocCat = String(t.budgetCategory ?? t.category ?? '').trim();
    if (!allocCat || allocCat === 'Uncategorized') {
      uncategorizedCount += 1;
      uncategorizedSar += amtSar;
    } else {
      categorizedSar += amtSar;
      if (!budgetedCats.has(allocCat)) {
        unbudgetedCount += 1;
        unbudgetedSar += amtSar;
      }
    }

    if (!t.expenseType && !t.transactionNature && !t.subcategory) {
      noMetadataCount += 1;
      noMetadataSar += amtSar;
    }

    const tierLabel = String(tierByCategory.get(allocCat) ?? 'Unassigned');
    const bump = (m: Map<string, { spent: number; count: number }>, key: string) => {
      const cur = m.get(key) ?? { spent: 0, count: 0 };
      cur.spent += amtSar;
      cur.count += 1;
      m.set(key, cur);
    };
    bump(tierMap, tierLabel);
    bump(expenseTypeMap, t.expenseType ?? 'Not set');
    bump(natureMap, t.transactionNature ?? 'Not set');
    bump(accountMap, accountNameById.get(String(t.accountId)) ?? 'Unknown');

    if ((t.status ?? 'Approved') === 'Approved') {
      for (const alloc of getTransactionBudgetAllocations(t)) {
        categoryTxCount.set(alloc.category, (categoryTxCount.get(alloc.category) ?? 0) + 1);
      }
      highlights.push({
        id: t.id,
        date: t.date,
        description: t.description,
        amountSar: amtSar,
        category: t.category,
        budgetCategory: t.budgetCategory,
        subcategory: t.subcategory,
        expenseType: t.expenseType,
        transactionNature: t.transactionNature,
        accountName: accountNameById.get(String(t.accountId)) ?? '—',
        note: t.note,
        isSplit: Array.isArray(t.splitLines) && t.splitLines.length > 0,
      });
    }
  }

  for (const row of categories) {
    row.transactionCount = categoryTxCount.get(row.category) ?? 0;
  }

  highlights.sort((a, b) => b.amountSar - a.amountSar);

  const monthlyTrend: ExpenseMonthTrendPoint[] = [];
  const trendKeys = financialMonthKeysEndingAt(ref, 6, monthStartDay);
  const trendIsoKeys = new Set(trendKeys.map((k) => financialMonthIsoKey(k)));
  const trendExpenseByKey = new Map<string, number>();
  const trendIncomeByKey = new Map<string, number>();
  for (const iso of trendIsoKeys) {
    trendExpenseByKey.set(iso, 0);
    trendIncomeByKey.set(iso, 0);
  }
  const trendEarliest = financialMonthRangeFromKey(trendKeys[0]!, monthStartDay).start;

  for (const t of transactions) {
    if (!dateInRange(t.date, trendEarliest, currentRange.end)) continue;
    const iso = financialMonthIsoKey(financialMonthKeyFromTransactionDate(t.date, monthStartDay));
    if (!trendIsoKeys.has(iso)) continue;
    const amtSar = expenseAmountSarForBudget(t, accountCurrencyById, data, exchangeRate);
    if (t.type === 'income' && (t.status ?? 'Approved') === 'Approved') {
      trendIncomeByKey.set(iso, (trendIncomeByKey.get(iso) ?? 0) + amtSar);
    } else if (countsAsExpenseForCashflowKpi(t) && (t.status ?? 'Approved') === 'Approved') {
      for (const alloc of getTransactionBudgetAllocations(t)) {
        const slice = expenseAmountSarForBudget(
          { ...t, amount: alloc.amount },
          accountCurrencyById,
          data,
          exchangeRate,
        );
        trendExpenseByKey.set(iso, (trendExpenseByKey.get(iso) ?? 0) + slice);
      }
    }
  }

  for (const k of trendKeys) {
    const iso = financialMonthIsoKey(k);
    const monthBudgeted = sumBudgetedSar(budgets, k, msd);
    const monthExpense = trendExpenseByKey.get(iso) ?? 0;
    const monthIncome = trendIncomeByKey.get(iso) ?? 0;
    const label =
      msd === 1
        ? new Date(k.year, k.month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        : financialMonthColumnHeaderLabel(k.year, k.month, monthStartDay);
    monthlyTrend.push({
      monthKey: iso,
      label,
      incomeSar: monthIncome,
      expenseSar: monthExpense,
      netSar: monthIncome - monthExpense,
      budgetedSar: monthBudgeted,
    });
  }

  const budgetVarianceSar = budgetedSar - expenseSar;
  const savingsRatePct = incomeSar > 0 ? ((incomeSar - expenseSar) / incomeSar) * 100 : null;

  const dataQuality: ExpenseDataQualityRow[] = [];
  if (uncategorizedCount > 0) {
    dataQuality.push({
      code: 'uncategorized',
      label: 'Missing budget/category tag',
      count: uncategorizedCount,
      amountSar: uncategorizedSar,
    });
  }
  if (unbudgetedCount > 0) {
    dataQuality.push({
      code: 'unbudgeted',
      label: 'Spend outside current budget envelopes',
      count: unbudgetedCount,
      amountSar: unbudgetedSar,
    });
  }
  if (pendingCount > 0) {
    dataQuality.push({ code: 'pending', label: 'Pending approval', count: pendingCount, amountSar: pendingSar });
  }
  if (noMetadataCount > 0) {
    dataQuality.push({
      code: 'no_metadata',
      label: 'No expense type / fixed-variable tag',
      count: noMetadataCount,
      amountSar: noMetadataSar,
    });
  }

  const driftRows = detectBudgetDrift(data, exchangeRate, ref);
  const insights: ExpenseDecisionInsight[] = [];

  if (budgetVarianceSar > 0 && budgetedSar > 0) {
    insights.push({
      priority: 'low',
      title: 'Under budget this month',
      detail: `You are ${Math.round(budgetVarianceSar).toLocaleString()} SAR below your set envelopes — consider moving the surplus to savings or goals.`,
      amountSar: budgetVarianceSar,
    });
  } else if (budgetVarianceSar < 0 && budgetedSar > 0) {
    insights.push({
      priority: 'high',
      title: 'Over total monthly budget',
      detail: `Expenses exceed envelopes by ${Math.round(Math.abs(budgetVarianceSar)).toLocaleString()} SAR. Review over-budget categories below.`,
      amountSar: Math.abs(budgetVarianceSar),
    });
  }

  for (const c of overBudgetCategories.slice(0, 5)) {
    const overBy = c.spentSar - c.limitSar;
    const isOptional = c.tier === 'Optional';
    insights.push({
      priority: isOptional ? 'high' : c.status === 'over' ? 'high' : 'medium',
      title: `${c.category} — ${c.utilizationPct.toFixed(0)}% of envelope`,
      detail: isOptional
        ? `Discretionary envelope exceeded by ${Math.round(overBy).toLocaleString()} SAR — easiest place to trim.`
        : `Over by ${Math.round(overBy).toLocaleString()} SAR vs your ${Math.round(c.limitSar).toLocaleString()} SAR limit.`,
      category: c.category,
      amountSar: overBy,
    });
  }

  for (const d of driftRows.slice(0, 3)) {
    insights.push({
      priority: d.driftPct > 25 ? 'high' : 'medium',
      title: `${d.category} spending drift`,
      detail: `This month is ${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs your 3-month average (${Math.round(d.baselineSar).toLocaleString()} → ${Math.round(d.currentSar).toLocaleString()} SAR).`,
      category: d.category,
    });
  }

  const discretionary = categories.find((c) => c.category.toLowerCase().includes('discretionary') || c.tier === 'Optional');
  if (discretionary && discretionary.spentSar > 0 && savingsRatePct != null && savingsRatePct < 10) {
    insights.push({
      priority: 'medium',
      title: 'Low savings rate with discretionary spend',
      detail: `Savings rate is ${savingsRatePct.toFixed(1)}% while discretionary/optional categories are active — pause non-essential buys until savings improve.`,
      amountSar: discretionary.spentSar,
    });
  }

  const outliers = detectPlanExpenseOutliers({ data, year: finKey.year, sarPerUsd: exchangeRate });
  if (outliers.length > 0) {
    insights.push({
      priority: 'high',
      title: 'Large one-off expenses detected',
      detail: `${outliers.length} transaction(s) dominate year spend — verify amounts and categories in Transactions.`,
      amountSar: outliers[0]?.amountSar,
    });
  }

  if (uncategorizedSar > expenseSar * 0.08 && uncategorizedSar > 500) {
    insights.push({
      priority: 'medium',
      title: 'Categorize uncoded spend',
      detail: `${Math.round(uncategorizedSar).toLocaleString()} SAR lacks a budget category — tagging improves limits and alerts.`,
      amountSar: uncategorizedSar,
    });
  }

  insights.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority];
  });

  const periodLabel =
    msd === 1
      ? new Date(finKey.year, finKey.month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : financialMonthColumnHeaderLabel(finKey.year, finKey.month, monthStartDay);

  return {
    periodLabel,
    monthStartDay: msd,
    summary: {
      incomeSar,
      expenseSar,
      netSar: incomeSar - expenseSar,
      budgetedSar,
      budgetVarianceSar,
      savingsRatePct,
      categorizedSharePct: expenseSar > 0 ? (categorizedSar / expenseSar) * 100 : 100,
      transactionCount: highlights.length,
    },
    categories,
    overBudgetCategories,
    underBudgetCategories,
    byTier: buildDimensionSlices(tierMap, expenseSar),
    byExpenseType: buildDimensionSlices(expenseTypeMap, expenseSar),
    byTransactionNature: buildDimensionSlices(natureMap, expenseSar),
    byAccount: buildDimensionSlices(accountMap, expenseSar),
    topTransactions: highlights.slice(0, 15),
    monthlyTrend,
    driftRows,
    dataQuality,
    insights: insights.slice(0, 12),
  };
}
