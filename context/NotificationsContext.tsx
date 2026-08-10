import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { Page, Transaction } from '../types';
import { DataContext } from './DataContext';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { useMarketDebouncedPrices } from '../hooks/useDebouncedMarketPrices';
import { useCanonicalSpotFx } from '../hooks/useCanonicalFinancialMetrics';
import {
  reconcileCashAccountBalance,
  reconcileCreditAccountBalance,
  detectStaleMarketData,
  detectStaleFxRate,
  collectTrackedSymbols,
  getStaleQuoteSymbols,
} from '../services/dataQuality';
import {
  filterUnackedCashDriftWarnings,
  resolveCashBalanceDriftAcks,
  resolveHoldingsIntegrityAcks,
} from '../services/uiAcks';
import { filterUnackedDriftRows } from '../services/holdingsIntegrityAck';
import { normalizedMonthlyExpenseSar, cashRunwayMonths } from '../services/financeMetrics';
import { salaryToExpenseCoverageSar } from '../services/salaryExpenseCoverage';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { toSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalCommodityHoldings, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { useTodosOptional } from './TodosContext';
import { computeTaskCounts } from '../services/todoModel';
import { isSupportedPageAction } from '../utils/pageActions';
import {
  buildHoldingsIntegrityFingerprint,
  buildHoldingsQtyDriftReport,
  holdingsQtyDriftNeedsAttention,
} from '../services/holdingsIntegrityRepair';
import { useEnhancementSignals } from '../hooks/useEnhancementSignals';
import { buildNotificationsDataFingerprint } from '../services/budgetSpendFingerprint';
import {
  addMonthsToKey,
  currentFinancialMonthIso,
  financialMonthIsoKey,
  financialMonthKeyFromTransactionDate,
  financialMonthRange,
  resolveMonthStartDayFromData,
} from '../utils/financialMonth';
import { detectSpendingAnomaliesFromTransactions } from '../services/householdBudgetAnalytics';
import { computeExpenseBudgetAnalysisModel } from '../services/expenseBudgetAnalysisModel';
import { buildBudgetDrillDownAction } from '../services/spendingDrillDown';
import { cachedSupabaseHeadCount } from '../services/supabaseQueryCache';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { rewardsExpiringWithinDays } from '../services/rewards/rewardsDomain';
import { computeSalaryInvestmentKpis } from '../services/salaryInvestmentKpis';

const READ_STORAGE_KEY = 'h.s.notifications.read';

export type NotificationCategory = 'Budget' | 'Goal' | 'Investment' | 'Transaction' | 'PriceAlert' | 'Plan' | 'System';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  message: string;
  date: string;
  isRead: boolean;
  pageLink: Page;
  /** e.g. #data-reconciliation — applied after navigation */
  pageHash?: string;
  pageAction?: string;
  symbol?: string;
  severity?: 'info' | 'warning' | 'urgent';
  actionHint?: string;
  score?: number;
}

function loadReadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try { localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids])); } catch {}
}

function asIsoString(value: unknown, fallback: Date): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback.toISOString() : value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

function safePageAction(page: Page, action: string): string | undefined {
  return isSupportedPageAction(page, action) ? action : undefined;
}

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const severityScore: Record<'info' | 'warning' | 'urgent', number> = {
  info: 1,
  warning: 2,
  urgent: 3,
};

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { data, showHydrateBanner } = useContext(DataContext) ?? {};
  const auth = useContext(AuthContext);
  const todosOpt = useTodosOptional();
  const sarPerUsd = useCanonicalSpotFx();
  const { lastUpdated, isLive, symbolQuoteUpdatedAt } = useMarketQuoteMeta();
  const { debouncedPrices } = useMarketDebouncedPrices();
  const staleQuoteScanAtRef = useRef(0);
  const enhancementSignals = useEnhancementSignals();
  const notificationsDataFingerprint = useMemo(
    () => buildNotificationsDataFingerprint(data),
    [
      data?.budgets,
      data?.goals,
      data?.transactions,
      data?.budgetRequests,
      data?.settings?.budgetThreshold,
      data?.investmentPlan,
      data?.plannedTrades,
      data?.executionLogs,
      data?.rewardsAccounts,
      data?.rewardsTransactions,
    ],
  );
  const deferredNotificationsFingerprint = useDeferredValue(notificationsDataFingerprint);
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  /** After mark-all, suppress async enhancement-signal alerts briefly so the badge stays cleared. */
  const dismissGraceUntilRef = useRef(0);

  const [pendingBudgetRequestCount, setPendingBudgetRequestCount] = useState(0);
  const [pendingTransactionApprovalCount, setPendingTransactionApprovalCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => { saveReadIds(readIds); }, [readIds]);

  useEffect(() => {
    let alive = true;
    if (!supabase || !auth?.user?.id || showHydrateBanner) {
      setPendingBudgetRequestCount(0);
      setPendingTransactionApprovalCount(0);
      setIsAdmin(false);
      return () => {
        alive = false;
      };
    }

    const userId = auth.user.id;
    const adminStatus = Boolean(auth.isAdmin);

    const loadPending = async () => {
      if (!alive || isBackgroundWorkPaused()) return;
      setIsAdmin(adminStatus);

      const budgetKey = `count:budget-requests-pending:${userId}`;
      const { count } = await cachedSupabaseHeadCount(
        budgetKey,
        () =>
          supabase!
            .from('budget_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'Pending')
            .eq('user_id', userId),
        120_000,
      );
      if (alive) setPendingBudgetRequestCount(Number(count || 0));

      if (adminStatus) {
        const txKey = `count:shared-tx-pending:${userId}`;
        const txRes = await cachedSupabaseHeadCount(
          txKey,
          () =>
            supabase!
              .from('budget_shared_transactions')
              .select('id', { count: 'exact', head: true })
              .eq('owner_user_id', userId)
              .eq('status', 'Pending'),
          120_000,
        );
        if (alive) setPendingTransactionApprovalCount(Number(txRes.count ?? 0));
      } else if (alive) {
        setPendingTransactionApprovalCount(0);
      }
    };

    const cancelIdle = scheduleIdleWork(() => {
      void loadPending();
    }, 1200);
    const timer = window.setInterval(() => {
      void loadPending();
    }, 120_000);

    return () => {
      alive = false;
      cancelIdle();
      window.clearInterval(timer);
    };
  }, [auth?.user?.id, auth?.isAdmin, showHydrateBanner]);

  const coreNotifications = useMemo<AppNotification[]>(() => {
    // Observe deferred fingerprint so rebuilds stay gated (not bare `data` identity).
    void deferredNotificationsFingerprint;
    const list: AppNotification[] = [];
    if (!data || showHydrateBanner) return list;
    const now = new Date();

    const push = (n: AppNotification) => {
      const sev = n.severity ?? 'info';
      const recencyHours = Math.max(1, (now.getTime() - new Date(n.date).getTime()) / 3600000);
      const recencyBoost = 1 / recencyHours;
      n.score = (severityScore[sev] * 10) + recencyBoost;
      list.push(n);
    };

    // Budgets: keep only the top 4 closest to breach
    const threshold = data.settings?.budgetThreshold ?? 90;
    const budgetCandidates = (data.budgets ?? []).map((b) => {
      const spent = Number((b as any).spent ?? (b as any).used ?? 0);
      const limit = Number((b as any).limit ?? (b as any).amount ?? 1);
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      return { b, pct };
    }).filter((x) => x.pct >= threshold).sort((a, b) => b.pct - a.pct).slice(0, 4);

    budgetCandidates.forEach(({ b, pct }) => {
      const period = String((b as any).period ?? 'monthly').toLowerCase();
      const periodTag = period === 'weekly' || period === 'yearly' || period === 'daily' ? period : 'monthly';
      const y = Number((b as any).year) || now.getFullYear();
      const m = Number((b as any).month) || (now.getMonth() + 1);
      push({
        id: `budget-${b.id}`,
        category: 'Budget',
        message: `"${b.category ?? 'Budget'}" is at ${pct.toFixed(0)}% of limit.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Transactions',
        pageAction: safePageAction('Transactions', `filter-by-budget:${encodeURIComponent(String(b.category ?? 'Other'))}:${periodTag}:${y}:${m}`),
        severity: pct >= 100 ? 'urgent' : 'warning',
        actionHint: pct >= 100 ? 'Review and reduce spending or increase approved limit.' : 'Monitor this category and reduce optional spend.',
      });
    });

    // Goals near deadline
    (data.goals ?? []).forEach((g) => {
      const targetDate = (g as any).targetDate ?? (g as any).target_date ?? (g as any).deadline;
      if (!targetDate) return;
      const d = new Date(targetDate);
      const daysLeft = Math.ceil((d.getTime() - now.getTime()) / 86400000);
      if (daysLeft <= 30 && daysLeft >= 0) {
        push({
          id: `goal-${g.id}`,
          category: 'Goal',
          message: `Goal "${g.name}" deadline is in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Goals',
          pageAction: safePageAction('Goals', `focus-goal:${encodeURIComponent(String(g.id ?? ''))}`),
          severity: daysLeft <= 7 ? 'urgent' : 'warning',
          actionHint: 'Increase monthly allocation or adjust goal deadline.',
        });
      }
    });

    const salaryInvestment = computeSalaryInvestmentKpis(data, sarPerUsd);
    if (salaryInvestment?.hasSalarySignal) {
      const lagDays = Math.max(1, Number(salaryInvestment.settings?.investLagAlertDays) || 7);
      const monthProgressDays = Math.max(
        0,
        Math.floor((now.getTime() - financialMonthRange(now, resolveMonthStartDayFromData(data)).start.getTime()) / 86400000),
      );
      if (salaryInvestment.hasTargetsConfigured && salaryInvestment.targetVsActualGapSar > 0 && monthProgressDays >= lagDays) {
        push({
          id: 'salary-invest-target-gap',
          category: 'Plan',
          message: `Salary invest target is short by ${Math.round(salaryInvestment.targetVsActualGapSar).toLocaleString()} SAR this financial month.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          pageAction: safePageAction('Investments', 'focus-salary-invest'),
          severity: salaryInvestment.salaryInvestRatePct < 25 ? 'warning' : 'info',
          actionHint: 'Review salary funding deposits, idle broker cash, and deployment this month.',
        });
      }
      if (salaryInvestment.fundedNotDeployedSar > 0) {
        push({
          id: 'salary-invest-funded-not-deployed',
          category: 'Investment',
          message: `${Math.round(salaryInvestment.fundedNotDeployedSar).toLocaleString()} SAR of salary-funded broker cash is still not deployed.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          pageAction: safePageAction('Investments', 'focus-salary-invest'),
          severity: salaryInvestment.fundedNotDeployedSar > salaryInvestment.investedFromSalarySarMonth * 0.5 ? 'warning' : 'info',
          actionHint: 'Open Investments to compare platform funding against actual buys.',
        });
      }
      const recentHistory = salaryInvestment.history.slice(-3);
      const underInvestingMonths = recentHistory.filter((row) => row.targetVsActualGapSar > 0).length;
      if (salaryInvestment.hasTargetsConfigured && underInvestingMonths >= 3) {
        push({
          id: 'salary-invest-rolling-trend',
          category: 'Plan',
          message: 'Salary invest target has been missed for 3 straight financial months.',
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          pageAction: safePageAction('Investments', 'focus-salary-invest'),
          severity: 'warning',
          actionHint: 'Review whether the target, salary tagging, or monthly deployment plan needs adjustment.',
        });
      }
      if (salaryInvestment.salaryDetectionConfidence === 'low') {
        push({
          id: 'salary-invest-low-confidence',
          category: 'System',
          message: 'Salary-invest attribution confidence is low. Salary source account or income tags may need cleanup.',
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Settings',
          pageAction: safePageAction('Settings', 'focus-salary-investing'),
          severity: 'info',
          actionHint: 'Set a preferred salary source account and keep salary transactions tagged consistently.',
        });
      }
    }

    (data.goals ?? []).forEach((g: any) => {
      const alloc = Number(g.savingsAllocationPercent) || 0;
      if (alloc > 0) return;
      const dl = g.deadline ? new Date(g.deadline) : null;
      if (!dl || isNaN(dl.getTime()) || dl.getTime() <= now.getTime()) return;
      const daysLeft = Math.ceil((dl.getTime() - now.getTime()) / 86400000);
      if (daysLeft > 540) return;
      push({
        id: `goal-no-alloc-${g.id}`,
        category: 'Goal',
        message: `Goal "${g.name}" has 0% savings allocation but a future deadline.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Goals',
        pageAction: safePageAction('Goals', `focus-goal:${encodeURIComponent(String(g.id ?? ''))}`),
        severity: 'info',
        actionHint: 'Set allocation % on the Goals page so funding suggestions reflect your priorities.',
      });
    });

    // Transaction approval notifications for admin (from shared budget transactions pending approval)
    if (isAdmin && pendingTransactionApprovalCount > 0) {
      push({
        id: 'tx-pending-approval-admin',
        category: 'Transaction',
        message: `${pendingTransactionApprovalCount} shared-budget transaction(s) need your approval.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        pageAction: safePageAction('Budgets', 'budgets-focus-admin-pending'),
        severity: 'warning',
        actionHint: 'Open Budgets to review and approve. Approved transactions will be reflected in shared budgets for all users with access.',
      });
    }

    // Budget request notifications for admin (pending requests from others)
    if (isAdmin && pendingBudgetRequestCount > 0) {
      push({
        id: 'budget-request-pending-admin',
        category: 'Budget',
        message: `${pendingBudgetRequestCount} budget request(s) pending your review.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        pageAction: safePageAction('Budgets', 'budgets-focus-admin-pending'),
        severity: 'warning',
        actionHint: 'Open Budgets to approve or reject requests.',
      });
    }

    // User: notifications for their own budget request outcomes (Finalized or Rejected)
    (data.budgetRequests ?? []).filter((r: any) => r.status === 'Finalized' || r.status === 'Rejected').forEach((r: any) => {
      const categoryLabel = r.category_name || r.categoryName || r.category_id || 'Request';
      push({
        id: `request-${r.id}`,
        category: 'Budget',
        message: r.status === 'Finalized' ? `Your budget request for "${categoryLabel}" was approved.` : `Your budget request for "${categoryLabel}" was rejected.`,
        date: asIsoString((r as any).updated_at ?? (r as any).created_at, now),
        isRead: false,
        pageLink: 'Budgets',
        pageAction: safePageAction('Budgets', r.status === 'Finalized' ? 'budgets-focus-my-pending' : 'budgets-open-request-form'),
        severity: r.status === 'Finalized' ? 'info' : 'warning',
        actionHint: r.status === 'Finalized' ? 'View your budgets to see the new category.' : 'You can submit a new request with different details.',
      });
    });

    // User notifications for their own budget requests
    if (!isAdmin && pendingBudgetRequestCount > 0) {
      push({
        id: 'my-budget-requests-pending',
        category: 'Budget',
        message: `You have ${pendingBudgetRequestCount} budget request(s) pending admin review.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        severity: 'info',
        actionHint: 'View your requests in the Budgets page.',
      });
    }

    // Cash runway — personal checking/savings in SAR vs SAR-normalized avg monthly expense
    const accountsForRunway = getPersonalAccounts(data);
    const transactionsForRunway = getPersonalTransactions(data);
    const liquidCashSar = accountsForRunway
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((sum, a) => {
        const bal = Math.max(0, Number(a.balance) || 0);
        const cur = a.currency === 'USD' ? 'USD' : 'SAR';
        return sum + toSAR(bal, cur, sarPerUsd);
      }, 0);
    const avgMonthlyExpenseSar = normalizedMonthlyExpenseSar(transactionsForRunway, accountsForRunway, sarPerUsd, {
      monthsLookback: 6,
      data,
    });
    const runwayMonths = cashRunwayMonths(liquidCashSar, avgMonthlyExpenseSar);
    if (avgMonthlyExpenseSar > 0 && runwayMonths > 0 && runwayMonths < 2) {
      push({
        id: 'cash-runway-low',
        category: 'System',
        message: `Cash runway is low (${runwayMonths.toFixed(1)} months).`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Accounts',
        severity: runwayMonths < 1 ? 'urgent' : 'warning',
        actionHint: 'Reduce discretionary expenses or increase income buffers (amounts use SAR and your FX rate).',
      });
    }

    const salCov = salaryToExpenseCoverageSar(transactionsForRunway, accountsForRunway, sarPerUsd, 6, data);
    if (salCov.ratio != null && salCov.ratio < 1 && salCov.ratio >= 0.2) {
      push({
        id: 'salary-vs-spend-heuristic',
        category: 'System',
        message: `Salary signal vs avg spend (SAR): ${salCov.ratio.toFixed(2)}× (under 1×). Review budget or income.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Analysis',
        severity: 'info',
        actionHint: 'Open Analysis for salary vs expense coverage and spend intelligence.',
      });
    }

    const cashDriftAcks = resolveCashBalanceDriftAcks(auth?.user?.id, data.settings);

    const driftCashAccounts: { id: string; name: string }[] = [];
    const cashDriftRows = accountsForRunway
      .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings' || a.type === 'Credit')
      .map((acc: { id: string; type: string; balance?: number; name?: string }) => {
        const r =
          acc.type === 'Credit'
            ? reconcileCreditAccountBalance(
                { id: acc.id, type: 'Credit', balance: acc.balance ?? 0 },
                transactionsForRunway as Transaction[],
              )
            : reconcileCashAccountBalance(
                { id: acc.id, type: acc.type as 'Checking' | 'Savings', balance: acc.balance ?? 0 },
                transactionsForRunway as Transaction[],
              );
        if (!r) return null;
        return {
          ...r,
          name: acc.name,
        };
      })
      .filter((x): x is NonNullable<typeof x> & { name?: string } => x != null);

    for (const r of filterUnackedCashDriftWarnings(cashDriftRows, cashDriftAcks)) {
      if (r.name) driftCashAccounts.push({ id: r.accountId, name: String(r.name) });
    }
    if (driftCashAccounts.length > 0) {
      const primary = driftCashAccounts[0];
      push({
        id: 'balance-reconciliation-drift',
        category: 'System',
        message: `Account balance may not match recorded transactions: ${driftCashAccounts
          .map((a) => String(a.name).slice(0, 40))
          .slice(0, 3)
          .join(', ')}${driftCashAccounts.length > 3 ? '…' : ''}.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Accounts',
        pageAction: safePageAction('Accounts', `open-reconcile-balance:${primary.id}`),
        severity: 'warning',
        actionHint: 'Opens Reconcile Balance for the first drifted account (append-only delta). Audit trail is under System & APIs Health.',
      });
    }

    const expiringRewards = rewardsExpiringWithinDays(
      data.rewardsAccounts ?? [],
      data.rewardsTransactions ?? [],
      30,
      new Date().toISOString().slice(0, 10),
      data.rewardsLots,
    );
    if (expiringRewards.length > 0) {
      push({
        id: 'rewards-expiring-30d',
        category: 'System',
        message: `${expiringRewards.length} rewards earn lot(s) expire within 30 days (${expiringRewards
          .slice(0, 3)
          .map((e) => e.providerName)
          .join(', ')}${expiringRewards.length > 3 ? '…' : ''}).`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Rewards',
        pageAction: safePageAction('Rewards', 'open-rewards-expire'),
        severity: 'warning',
        actionHint: 'Open Rewards to redeem or review expiring lots before they lapse.',
      });
    }
    const incompleteRedeems = (data.rewardsTransactions ?? []).filter((t) => t.status === 'incomplete');
    if (incompleteRedeems.length > 0) {
      push({
        id: 'rewards-incomplete-redeem',
        category: 'System',
        message: `${incompleteRedeems.length} rewards redemption(s) incomplete — ledger leg may have failed.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Rewards',
        pageAction: safePageAction('Rewards', 'open-redeem'),
        severity: 'urgent',
        actionHint: 'Review Rewards activity and retry or reverse incomplete redemptions.',
      });
    }

    const hasMarketExposure =
      (getPersonalInvestments(data).length > 0 ||
        (data.watchlist ?? []).length > 0 ||
        getPersonalCommodityHoldings(data).length > 0);
    if (hasMarketExposure) {
      const nowMs = Date.now();
      const allowStaleQuoteScan = nowMs - staleQuoteScanAtRef.current >= 60_000;
      if (allowStaleQuoteScan) staleQuoteScanAtRef.current = nowMs;

      const staleM = detectStaleMarketData(lastUpdated, isLive);
      if (staleM.isStale) {
        push({
          id: 'market-data-stale',
          category: 'System',
          message: staleM.message,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          severity: 'warning',
          actionHint: 'Use the header refresh control to pull latest quotes (live mode) or open Investments.',
        });
      }
      const tracked = collectTrackedSymbols(data as Parameters<typeof collectTrackedSymbols>[0]);
      const hoursSinceGlobal = lastUpdated != null && !Number.isNaN(lastUpdated.getTime())
        ? (Date.now() - lastUpdated.getTime()) / 3600000
        : 999;
      const globalFresh = hoursSinceGlobal < 2;
      const staleSyms = allowStaleQuoteScan
        ? getStaleQuoteSymbols(tracked, symbolQuoteUpdatedAt, isLive, {
            countMissingTimestampAsStale: !globalFresh,
          })
        : [];
      const priceTriggeredPlans = (data.plannedTrades ?? []).filter(
        (p) => p.status !== 'Executed' && p.conditionType === 'price' && (p.symbol ?? '').trim(),
      );
      const stalePlanSymbols = staleSyms.filter((s) =>
        priceTriggeredPlans.some((p) => (p.symbol ?? '').toUpperCase() === s),
      );
      if (allowStaleQuoteScan && staleSyms.length > 0) {
        push({
          id: 'market-symbols-stale',
          category: 'System',
          message: `Stale quotes (${isLive ? 'live' : 'sim'} mode): ${staleSyms.slice(0, 6).join(', ')}${staleSyms.length > 6 ? '…' : ''}${
            stalePlanSymbols.length > 0
              ? ` — affects ${stalePlanSymbols.length} price-triggered plan(s).`
              : ''
          }`,
          date: now.toISOString(),
          isRead: false,
          pageLink: stalePlanSymbols.length > 0 ? 'Investments' : 'Watchlist',
          severity: 'warning',
          actionHint: 'Use Refresh prices in the header. Investment Plan triggers may be wrong until quotes update.',
        });
      }
    }

    const fxFromPlan = (data.investmentPlan as { fxRateUpdatedAt?: string } | undefined)?.fxRateUpdatedAt;
    let fxConfirmedAt: string | null = fxFromPlan ?? null;
    if (!fxConfirmedAt) {
      try {
        if (auth?.user?.id && typeof window !== 'undefined') {
          fxConfirmedAt = localStorage.getItem(`finova_fx_plan_confirmed_${auth.user.id}`);
        }
      } catch {
        fxConfirmedAt = null;
      }
    }
    const fxStale = detectStaleFxRate(fxConfirmedAt, 14);
    if (fxStale.isStale && hasMarketExposure) {
      push({
        id: 'fx-rate-stale',
        category: 'System',
        message: fxStale.message,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Investments',
        pageAction: safePageAction('Investments', 'investment-tab:Investment Plan'),
        severity: 'info',
        actionHint: 'Save your Monthly Plan in Investments to confirm you reviewed USD/SAR assumptions.',
      });
    }

    // Price alerts triggered
    (data.priceAlerts ?? []).filter((a) => a.status === 'triggered').forEach((a) => {
      push({
        id: `price-${a.id}`,
        category: 'PriceAlert',
        message: `${a.symbol} has reached your target price.`,
        date: asIsoString((a as any).createdAt ?? (a as any).created_at, now),
        isRead: false,
        pageLink: 'Investments',
        pageAction: safePageAction('Investments', 'investment-tab:Watchlist'),
        symbol: a.symbol,
        severity: 'urgent',
        actionHint: 'Review execution decision in Investments.',
      });
    });

    // Smart monthly digest (external expenses only, SAR-normalized per account currency)
    const monthStartDay = resolveMonthStartDayFromData(data);
    const accByIdRunway = new Map(accountsForRunway.map((a) => [a.id, a]));
    const monthlyExpensesByKey = new Map<string, number>();
    transactionsForRunway.forEach((t) => {
      if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
      const key = financialMonthIsoKey(financialMonthKeyFromTransactionDate(t.date, monthStartDay));
      const cur = accByIdRunway.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
      const add = toSAR(Math.abs(Number(t.amount) || 0), cur, sarPerUsd);
      monthlyExpensesByKey.set(key, (monthlyExpensesByKey.get(key) || 0) + add);
    });
    const thisMonthKey = currentFinancialMonthIso(now, monthStartDay);
    const { key: prevFinKey } = financialMonthRange(now, monthStartDay);
    const lastMonthKey = financialMonthIsoKey(addMonthsToKey(prevFinKey, -1));
    const thisMonthExpense = monthlyExpensesByKey.get(thisMonthKey) || 0;
    const lastMonthExpense = monthlyExpensesByKey.get(lastMonthKey) || 0;
    if (thisMonthExpense > 0 && lastMonthExpense > 0 && thisMonthExpense > lastMonthExpense * 1.2) {
      push({
        id: 'expense-spike-monthly',
        category: 'Plan',
        message: `Spending this month is ${(thisMonthExpense / lastMonthExpense * 100 - 100).toFixed(0)}% higher than last month.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Plan',
        severity: 'warning',
        actionHint: 'Open Plan to inspect categories driving the spike (compare like-for-like in SAR).',
      });
    }

    const todayYmd = now.toISOString().slice(0, 10);
    const tdList = todosOpt?.todos;
    if (tdList?.length) {
      const { overdue, dueToday } = computeTaskCounts(tdList, todayYmd);
      if (dueToday > 0) {
        push({
          id: `todo-digest-due-${todayYmd}`,
          category: 'System',
          message: `You have ${dueToday} task${dueToday === 1 ? '' : 's'} due today.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Notifications',
          severity: 'warning',
          actionHint: 'Open My tasks on the Tasks & alerts page.',
        });
      }
      if (overdue > 0) {
        push({
          id: `todo-digest-overdue-${todayYmd}`,
          category: 'System',
          message: `You have ${overdue} overdue task${overdue === 1 ? '' : 's'}.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Notifications',
          severity: 'urgent',
          actionHint: 'Complete, snooze, or reschedule from My tasks.',
        });
      }
    }

    const inDismissGrace = Date.now() < dismissGraceUntilRef.current;
    if (!inDismissGrace) {
      for (const c of enhancementSignals.goalConflicts) {
        push({
          id: `goal-conflict-${c.id}`,
          category: 'Goal',
          message: c.message,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Goals',
          severity: c.severity === 'critical' ? 'urgent' : 'warning',
          actionHint: 'Review goal deadlines and linked budgets or investments on Goals.',
        });
      }
      for (const d of enhancementSignals.budgetDrift.slice(0, 2)) {
        push({
          id: `budget-drift-${d.category}`,
          category: 'Budget',
          message: `${d.category} spend is ${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs your 3-month baseline.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Analysis',
          pageAction: safePageAction(
            'Transactions',
            buildBudgetDrillDownAction({ budgetCategory: d.category, data }),
          ),
          severity: Math.abs(d.driftPct) >= 30 ? 'warning' : 'info',
          actionHint: 'Open Analysis or Transactions to adjust limits or investigate the category.',
        });
      }

      const spendModel = computeExpenseBudgetAnalysisModel(data, sarPerUsd, now, 'personal');
      if (spendModel) {
        const finIso = currentFinancialMonthIso(now, resolveMonthStartDayFromData(data));
        for (const c of spendModel.overBudgetCategories.slice(0, 3)) {
          push({
            id: `spend-envelope-${c.category}-${finIso}`,
            category: 'Budget',
            message: `"${c.category}" is ${c.utilizationPct.toFixed(0)}% of your fiscal envelope (${Math.round(c.spentSar).toLocaleString()} / ${Math.round(c.limitSar).toLocaleString()} SAR).`,
            date: now.toISOString(),
            isRead: false,
            pageLink: 'Transactions',
            pageAction: safePageAction(
              'Transactions',
              buildBudgetDrillDownAction({ budgetCategory: c.category, data }),
            ),
            severity: c.utilizationPct >= 100 ? 'urgent' : 'warning',
            actionHint: 'Review transactions in this category or adjust the budget envelope.',
          });
        }
      }

      const monthStartDay = resolveMonthStartDayFromData(data);
      const finKey = financialMonthKeyFromTransactionDate(now, monthStartDay);
      const anomalies = detectSpendingAnomaliesFromTransactions({
        year: finKey.year,
        transactions: getPersonalTransactions(data),
        accounts: getPersonalAccounts(data),
        sarPerUsd,
        monthStartDay,
      });
      for (const a of anomalies.slice(0, 2)) {
        push({
          id: `spend-anomaly-${a.category}-${finKey.month}`,
          category: 'Budget',
          message: `Unusual spend in ${a.category}: ${a.explanation}`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Transactions',
          pageAction: safePageAction(
            'Transactions',
            buildBudgetDrillDownAction({ budgetCategory: a.category, data }),
          ),
          severity: a.severity === 'high' ? 'urgent' : 'warning',
          actionHint: 'Review this month’s transactions for one-off or mis-categorized items.',
        });
      }
    }

    const execLogs = (data.executionLogs ?? []) as { created_at?: string; date?: string }[];
    const lastExecMs = execLogs.reduce((max, log) => {
      const raw = log.created_at ?? log.date;
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(t) ? Math.max(max, t) : max;
    }, 0);
    const daysSinceExec = lastExecMs > 0 ? (Date.now() - lastExecMs) / 86400000 : 999;
    const planBudget = Number((data.investmentPlan as { monthlyBudget?: number } | undefined)?.monthlyBudget ?? 0);
    if (planBudget > 0 && daysSinceExec > 35 && hasMarketExposure) {
      push({
        id: 'plan-run-stale',
        category: 'Plan',
        message: 'No investment plan execution logged in over 5 weeks — review planned trades or run the monthly plan.',
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Investments',
        pageAction: safePageAction('Investments', 'investment-tab:Execution History'),
        severity: 'info',
        actionHint: 'Open Execution History or Investment Plan to execute or refresh targets.',
      });
    }

    return list;
  }, [
    // Gate rebuilds on the deferred fingerprint (not bare `data`) so hydrate/quote churn can defer.
    deferredNotificationsFingerprint,
    showHydrateBanner,
    lastUpdated,
    isLive,
    symbolQuoteUpdatedAt,
    sarPerUsd,
    pendingBudgetRequestCount,
    pendingTransactionApprovalCount,
    isAdmin,
    auth?.user?.id,
    data?.settings?.uiAcks,
    todosOpt?.todos,
    enhancementSignals.goalConflicts.length,
    enhancementSignals.budgetDrift.length,
  ]);

  /**
   * Holdings qty integrity — keyed only on qty/ledger fingerprint, never quote/FX ticks.
   * Running buildHoldingsQtyDriftReport inside coreNotifications caused main-thread lag on every mark.
   */
  const holdingsIntegrityFp = buildHoldingsIntegrityFingerprint(data);
  const holdingsIntegrityNotifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    if (!data || showHydrateBanner) return list;
    const holdingsAcks = resolveHoldingsIntegrityAcks(auth?.user?.id, data.settings);
    const qtyDrift = filterUnackedDriftRows(
      holdingsQtyDriftNeedsAttention(buildHoldingsQtyDriftReport(data)),
      holdingsAcks,
    );
    if (qtyDrift.length === 0) return list;
    const now = new Date();
    const primary = qtyDrift[0];
    const holdingId = getPersonalInvestments(data)
      .find((p) => p.id === primary.portfolioId)
      ?.holdings?.find((h) => String(h.symbol ?? '').toUpperCase() === primary.symbol)?.id;
    const n: AppNotification = {
      id: 'holdings-qty-integrity-drift',
      category: 'System',
      message: `Holding quantity may not match the investment ledger: ${qtyDrift
        .map((r) => r.symbol)
        .slice(0, 3)
        .join(', ')}${qtyDrift.length > 3 ? '…' : ''}.`,
      date: now.toISOString(),
      isRead: false,
      pageLink: 'Investments',
      pageAction: holdingId
        ? safePageAction('Investments', `open-reconcile-quantity:${holdingId}`)
        : undefined,
      severity: 'warning',
      actionHint: 'Opens Reconcile quantity for the first drifted holding (symbol-only; audited).',
    };
    const sev = n.severity ?? 'info';
    n.score = severityScore[sev] * 10 + 1;
    list.push(n);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- holdingsIntegrityFp gates ledger inputs
  }, [holdingsIntegrityFp, showHydrateBanner, auth?.user?.id, data?.settings?.uiAcks]);

  const priceTriggeredPlanNotifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    if (!data || showHydrateBanner) return list;
    const now = new Date();
    const push = (n: AppNotification) => {
      const sev = n.severity ?? 'info';
      const recencyHours = Math.max(1, (now.getTime() - new Date(n.date).getTime()) / 3600000);
      n.score = (severityScore[sev] * 10) + 1 / recencyHours;
      list.push(n);
    };
    (data.plannedTrades ?? []).filter((p) => p.status === 'Planned').forEach((plan) => {
      const priceInfo = debouncedPrices?.[plan.symbol];
      if (!priceInfo) return;
      const targetVal = (plan as any).target_value ?? (plan as any).targetValue ?? 0;
      const tradeType = (plan as any).trade_type ?? plan.tradeType ?? 'buy';
      const triggered =
        (tradeType === 'buy' && priceInfo.price <= targetVal) ||
        (tradeType === 'sell' && priceInfo.price >= targetVal);
      if (triggered) {
        push({
          id: `plan-${plan.id}`,
          category: 'Plan',
          message: `Target met: ${tradeType.toUpperCase()} ${plan.name ?? plan.symbol} ready to execute.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          pageAction: safePageAction('Investments', 'open-trade-modal:from-plan'),
          symbol: plan.symbol,
          severity: 'urgent',
          actionHint: 'Open Investments and execute or reschedule this plan.',
        });
      }
    });
    return list;
  }, [data, showHydrateBanner, debouncedPrices]);

  const notifications = useMemo<AppNotification[]>(() => {
    const merged = [...coreNotifications, ...holdingsIntegrityNotifications, ...priceTriggeredPlanNotifications];
    return merged
      .sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 40);
  }, [coreNotifications, holdingsIntegrityNotifications, priceTriggeredPlanNotifications]);

  const notificationsWithRead = useMemo(
    () => notifications.map((n) => ({ ...n, isRead: readIds.has(n.id) })),
    [notifications, readIds]
  );

  const unreadCount = useMemo(() => notificationsWithRead.filter((n) => !n.isRead).length, [notificationsWithRead]);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => new Set([...prev, id]));
  }, []);

  const markAllAsRead = useCallback(() => {
    dismissGraceUntilRef.current = Date.now() + 30_000;
    setReadIds((prev) => new Set([...prev, ...notifications.map((n) => n.id)]));
  }, [notifications]);

  const value = useMemo<NotificationsContextValue>(() => ({
    notifications: notificationsWithRead,
    unreadCount,
    markAsRead,
    markAllAsRead,
  }), [notificationsWithRead, unreadCount, markAsRead, markAllAsRead]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  return ctx;
}
