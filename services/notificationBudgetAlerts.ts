/**
 * Budget-related app notifications — single source for threshold / drift / envelope /
 * anomaly alerts so NotificationsContext and tests share the same yearly-gate + drill-down rules.
 */
import type { Account, Budget, FinancialData, Page, Transaction } from '../types';
import {
  buildNormalizedSpendLookup,
  isYearlyPeriodBudget,
  resolveBudgetCategoryHeadroom,
  shouldWarnBudgetOverspend,
  spendFromNormalizedLookup,
  ytdRangeForFinancialMonth,
} from './budgetOverspendGate';
import { aggregatePersonalBudgetCategorySpendSar } from './budgetSpendMath';
import { buildBudgetDrillDownAction } from './spendingDrillDown';
import { computeExpenseBudgetAnalysisModel } from './expenseBudgetAnalysisModel';
import { detectSpendingAnomaliesFromTransactions } from './householdBudgetAnalytics';
import type { BudgetDriftRow } from './budgetDrift';
import {
  budgetsForFinancialMonthView,
  currentFinancialMonthIso,
  financialMonthKeyFromTransactionDate,
  financialMonthRange,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { normalizeBudgetCategoryKey } from '../utils/budgetPeriod';
import { getPersonalAccounts, getPersonalTransactions } from '../utils/wealthScope';
import { isSupportedPageAction } from '../utils/pageActions';

export type BudgetAppNotification = {
  id: string;
  category: 'Budget';
  message: string;
  date: string;
  isRead: false;
  pageLink: Page;
  pageAction?: string;
  severity: 'info' | 'warning' | 'urgent';
  actionHint?: string;
};

function safePageAction(page: Page, action: string): string | undefined {
  return isSupportedPageAction(page, action) ? action : undefined;
}

/** Period tag for filter-by-budget — yearly aliases collapse to `yearly`. */
export function notificationBudgetPeriodTag(b: { period?: string | null }): 'yearly' | 'weekly' | 'daily' | 'monthly' {
  if (isYearlyPeriodBudget(b)) return 'yearly';
  const p = String(b.period ?? 'monthly').trim().toLowerCase();
  if (p === 'weekly' || p === 'daily') return p;
  return 'monthly';
}

/** Drill-down action that matches the governing envelope period for the category. */
export function buildNotificationBudgetDrillAction(args: {
  category: string;
  data: FinancialData;
  budgets: Budget[];
  finKey: FinancialMonthKey;
  monthStartDay: unknown;
  now?: Date;
}): string {
  const year = args.finKey.year;
  const catKey = normalizeBudgetCategoryKey(args.category);
  const yearly =
    args.budgets.find(
      (b) =>
        normalizeBudgetCategoryKey(b.category) === catKey &&
        Number(b.year) === year &&
        isYearlyPeriodBudget(b),
    ) ??
    args.budgets.find(
      (b) => normalizeBudgetCategoryKey(b.category) === catKey && isYearlyPeriodBudget(b),
    );
  const period = yearly ? ('yearly' as const) : ('monthly' as const);
  return buildBudgetDrillDownAction({
    budgetCategory: args.category,
    data: args.data,
    period,
    year: args.finKey.year,
    month: args.finKey.month,
    monthStartDay: Number(args.monthStartDay) || 1,
    anchorDate: (args.now ?? new Date()).toISOString().slice(0, 10),
  });
}

/**
 * Assert pageLink and pageAction always pair — drill actions are Transactions-only.
 * Prevents silent drop when click handlers check isSupportedPageAction(pageLink, pageAction).
 */
export function withTransactionsDrillDown(
  pageAction: string | undefined,
): { pageLink: Page; pageAction?: string } {
  if (!pageAction) return { pageLink: 'Transactions' };
  const ok = isSupportedPageAction('Transactions', pageAction);
  return { pageLink: 'Transactions', pageAction: ok ? pageAction : undefined };
}

export type BuildBudgetRelatedNotificationsArgs = {
  data: FinancialData;
  sarPerUsd: number;
  now?: Date;
  /** From enhancement signals — already sliced upstream if desired. */
  budgetDrift?: BudgetDriftRow[];
  /** When true, skip drift / envelope / anomaly enhancement block. */
  skipEnhancementBudgetAlerts?: boolean;
};

/**
 * Build budget threshold + (optional) drift / envelope / anomaly notifications.
 * Yearly-period categories use YTD vs annual cap; lumpy months within plan stay quiet.
 */
export function buildBudgetRelatedNotifications(
  args: BuildBudgetRelatedNotificationsArgs,
): BudgetAppNotification[] {
  const data = args.data;
  const now = args.now ?? new Date();
  const list: BudgetAppNotification[] = [];
  const threshold = data.settings?.budgetThreshold ?? 90;
  const monthStartDay = resolveMonthStartDayFromData(data);
  const finRange = financialMonthRange(now, monthStartDay);
  const accounts = getPersonalAccounts(data);
  const txs = getPersonalTransactions(data);
  const accFx = new Map(
    accounts.map((a) => [String(a.id), (a.currency === 'USD' ? 'USD' : 'SAR') as 'SAR' | 'USD']),
  );
  const monthSpend = aggregatePersonalBudgetCategorySpendSar(
    txs,
    finRange.start,
    finRange.end,
    accFx,
    data,
    args.sarPerUsd,
  );
  const { start: ytdStart, end: ytdEnd } = ytdRangeForFinancialMonth(finRange.key, monthStartDay);
  const ytdSpend = aggregatePersonalBudgetCategorySpendSar(
    txs,
    ytdStart,
    ytdEnd,
    accFx,
    data,
    args.sarPerUsd,
  );
  const monthLookup = buildNormalizedSpendLookup(monthSpend);
  const ytdLookup = buildNormalizedSpendLookup(ytdSpend);
  const budgets = data.budgets ?? [];
  const warnedCategoryKeys = new Set<string>();

  const headroomFor = (category: string, monthFallback = 0) =>
    resolveBudgetCategoryHeadroom({
      category,
      finKey: finRange.key,
      monthStartDay,
      budgets,
      monthSpentSar: spendFromNormalizedLookup(monthLookup, category) || monthFallback,
      ytdSpentSar: spendFromNormalizedLookup(ytdLookup, category),
    });

  const drillFor = (category: string) =>
    buildNotificationBudgetDrillAction({
      category,
      data,
      budgets,
      finKey: finRange.key,
      monthStartDay,
      now,
    });

  // Primary: top 4 closest to breach (yearly uses YTD vs yearly cap).
  const budgetCandidates = budgetsForFinancialMonthView(budgets, finRange.key, monthStartDay)
    .map((b) => {
      const cat = String(b.category ?? '').trim() || 'Budget';
      const headroom = headroomFor(cat);
      const pct = headroom.hasAnnualEnvelope ? headroom.annualUtilizationPct : headroom.utilizationPct;
      return { b, pct, headroom, cat };
    })
    .filter((x) => x.pct >= threshold && shouldWarnBudgetOverspend(x.headroom, threshold))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  for (const { b, pct, headroom, cat } of budgetCandidates) {
    const periodTag = notificationBudgetPeriodTag(b);
    const y = Number((b as { year?: number }).year) || now.getFullYear();
    const m = Number((b as { month?: number }).month) || finRange.key.month;
    const envelopeLabel = headroom.hasAnnualEnvelope ? 'yearly plan' : 'limit';
    const action = `filter-by-budget:${encodeURIComponent(cat)}:${periodTag}:${y}:${m}`;
    const drill = withTransactionsDrillDown(safePageAction('Transactions', action));
    list.push({
      id: `budget-${b.id}`,
      category: 'Budget',
      message: `"${cat}" is at ${pct.toFixed(0)}% of ${envelopeLabel}.`,
      date: now.toISOString(),
      isRead: false,
      ...drill,
      severity: pct >= 100 ? 'urgent' : 'warning',
      actionHint:
        pct >= 100
          ? headroom.hasAnnualEnvelope
            ? 'YTD exceeds the yearly plan — reduce spend or raise the annual limit.'
            : 'Review and reduce spending or increase approved limit.'
          : headroom.hasAnnualEnvelope
            ? 'Approaching yearly plan — lumpy months are OK while YTD stays within the annual cap.'
            : 'Monitor this category and reduce optional spend.',
    });
    warnedCategoryKeys.add(normalizeBudgetCategoryKey(cat));
  }

  if (args.skipEnhancementBudgetAlerts) return list;

  const driftRows = (args.budgetDrift ?? []).slice(0, 2);
  for (const d of driftRows) {
    const driftHeadroom = headroomFor(d.category);
    if (driftHeadroom.hasAnnualEnvelope && driftHeadroom.annualUtilizationPct <= 100.0001) {
      continue;
    }
    const drill = withTransactionsDrillDown(safePageAction('Transactions', drillFor(d.category)));
    list.push({
      id: `budget-drift-${d.category}`,
      category: 'Budget',
      message: `${d.category} spend is ${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs your 3-month baseline.`,
      date: now.toISOString(),
      isRead: false,
      ...drill,
      severity: Math.abs(d.driftPct) >= 30 ? 'warning' : 'info',
      actionHint: 'Open Transactions to adjust limits or investigate the category.',
    });
  }

  const spendModel = computeExpenseBudgetAnalysisModel(data, args.sarPerUsd, now, 'personal');
  if (spendModel) {
    const finIso = currentFinancialMonthIso(now, monthStartDay);
    for (const c of spendModel.overBudgetCategories.slice(0, 3)) {
      const catKey = normalizeBudgetCategoryKey(c.category);
      // Avoid duplicate urgent rows when primary budget alert already covers this category.
      if (warnedCategoryKeys.has(catKey)) continue;
      const headroom = headroomFor(c.category);
      if (!shouldWarnBudgetOverspend(headroom, 100) && headroom.hasAnnualEnvelope) continue;
      // Monthly overspend already gated by model; yearly only when annual breached.
      if (headroom.hasAnnualEnvelope && !shouldWarnBudgetOverspend(headroom, 100)) continue;
      const utilPct = headroom.hasAnnualEnvelope ? headroom.annualUtilizationPct : c.utilizationPct;
      const spentShow = headroom.hasAnnualEnvelope ? headroom.spentSar : c.spentSar;
      const limitShow = headroom.hasAnnualEnvelope ? headroom.annualLimitSar : c.limitSar;
      const envelopeWord = headroom.hasAnnualEnvelope ? 'yearly plan' : 'fiscal envelope';
      const drill = withTransactionsDrillDown(safePageAction('Transactions', drillFor(c.category)));
      list.push({
        id: `spend-envelope-${c.category}-${finIso}`,
        category: 'Budget',
        message: `"${c.category}" is ${utilPct.toFixed(0)}% of your ${envelopeWord} (${Math.round(spentShow).toLocaleString()} / ${Math.round(limitShow).toLocaleString()} SAR).`,
        date: now.toISOString(),
        isRead: false,
        ...drill,
        severity: utilPct >= 100 ? 'urgent' : 'warning',
        actionHint: headroom.hasAnnualEnvelope
          ? 'YTD exceeds the yearly plan — reduce spend or raise the annual limit.'
          : 'Review transactions in this category or adjust the budget envelope.',
      });
      warnedCategoryKeys.add(catKey);
    }
  }

  const finKey = financialMonthKeyFromTransactionDate(now, monthStartDay);
  const anomalies = detectSpendingAnomaliesFromTransactions({
    year: finKey.year,
    transactions: txs as Transaction[],
    accounts: accounts as Account[],
    sarPerUsd: args.sarPerUsd,
    monthStartDay,
    budgets,
  }).filter((a) => {
    if (a.month !== finKey.month) return false;
    const headroom = headroomFor(a.category, a.actualAmount);
    if (headroom.hasAnnualEnvelope && headroom.annualUtilizationPct <= 100.0001) return false;
    return true;
  });
  for (const a of anomalies.slice(0, 2)) {
    const drill = withTransactionsDrillDown(safePageAction('Transactions', drillFor(a.category)));
    list.push({
      id: `spend-anomaly-${a.category}-${finKey.month}`,
      category: 'Budget',
      message: `Unusual spend in ${a.category}: ${a.explanation}`,
      date: now.toISOString(),
      isRead: false,
      ...drill,
      severity: a.severity === 'high' ? 'urgent' : 'warning',
      actionHint: 'Review this month’s transactions for one-off or mis-categorized items.',
    });
  }

  return list;
}
