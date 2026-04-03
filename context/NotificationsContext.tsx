import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { Page, Transaction } from '../types';
import { DataContext } from './DataContext';
import { useMarketData } from './MarketDataContext';
import { useCurrency } from './CurrencyContext';
import {
  reconcileCashAccountBalance,
  detectStaleMarketData,
  detectStaleFxRate,
  collectTrackedSymbols,
  getStaleQuoteSymbols,
} from '../services/dataQuality';
import { normalizedMonthlyExpenseSar, cashRunwayMonths } from '../services/financeMetrics';
import { salaryToExpenseCoverageSar } from '../services/salaryExpenseCoverage';
import { countsAsExpenseForCashflowKpi } from '../services/transactionFilters';
import { resolveSarPerUsd, toSAR } from '../utils/currencyMath';
import { getPersonalAccounts, getPersonalCommodityHoldings, getPersonalInvestments, getPersonalTransactions } from '../utils/wealthScope';
import { useTodosOptional } from './TodosContext';
import { computeTaskCounts } from '../services/todoModel';
import { isSupportedPageAction } from '../utils/pageActions';

const READ_STORAGE_KEY = 'h.s.notifications.read';

export type NotificationCategory = 'Budget' | 'Goal' | 'Investment' | 'Transaction' | 'PriceAlert' | 'Plan' | 'System';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  message: string;
  date: string;
  isRead: boolean;
  pageLink: Page;
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
  const { data } = useContext(DataContext) ?? {};
  const auth = useContext(AuthContext);
  const todosOpt = useTodosOptional();
  const { exchangeRate } = useCurrency();
  const { simulatedPrices, lastUpdated, isLive, symbolQuoteUpdatedAt } = useMarketData();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  const [pendingBudgetRequestCount, setPendingBudgetRequestCount] = useState(0);
  const [pendingTransactionApprovalCount, setPendingTransactionApprovalCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => { saveReadIds(readIds); }, [readIds]);

  useEffect(() => {
    let alive = true;
    const loadPending = async () => {
      if (!supabase || !auth?.user?.id) {
        if (alive) { setPendingBudgetRequestCount(0); setPendingTransactionApprovalCount(0); }
        return;
      }
      const { data: userRow } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
      const adminStatus = String((userRow as any)?.role || '').toLowerCase() === 'admin';
      if (alive) setIsAdmin(adminStatus);
      let query = supabase.from('budget_requests').select('id', { count: 'exact', head: true }).eq('status', 'Pending');
      if (!adminStatus) query = query.eq('user_id', auth.user.id);
      const { count } = await query;
      if (alive) setPendingBudgetRequestCount(Number(count || 0));
      if (adminStatus) {
        const txRes = await supabase.from('budget_shared_transactions').select('id', { count: 'exact', head: true }).eq('status', 'Pending');
        if (alive) setPendingTransactionApprovalCount(Number((txRes as any).count ?? 0));
      } else if (alive) setPendingTransactionApprovalCount(0);
    };

    loadPending();
    const timer = window.setInterval(loadPending, 60000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [auth?.user?.id]);

  const notifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    if (!data) return list;
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
    const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
    const liquidCashSar = accountsForRunway
      .filter((a) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((sum, a) => {
        const bal = Math.max(0, Number(a.balance) || 0);
        const cur = a.currency === 'USD' ? 'USD' : 'SAR';
        return sum + toSAR(bal, cur, sarPerUsd);
      }, 0);
    const avgMonthlyExpenseSar = normalizedMonthlyExpenseSar(transactionsForRunway, accountsForRunway, sarPerUsd, {
      monthsLookback: 6,
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

    const salCov = salaryToExpenseCoverageSar(transactionsForRunway, accountsForRunway, sarPerUsd, 6);
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

    const driftCashNames: string[] = [];
    accountsForRunway
      .filter((a: { type?: string }) => a.type === 'Checking' || a.type === 'Savings')
      .forEach((acc: { id: string; type: string; balance?: number; name?: string }) => {
        const r = reconcileCashAccountBalance(
          { id: acc.id, type: acc.type as 'Checking' | 'Savings', balance: acc.balance ?? 0 },
          transactionsForRunway as Transaction[]
        );
        if (r?.showWarning && acc.name) driftCashNames.push(String(acc.name));
      });
    if (driftCashNames.length > 0) {
      push({
        id: 'balance-reconciliation-drift',
        category: 'System',
        message: `Cash account balance may not match recorded transactions: ${driftCashNames.slice(0, 3).join(', ')}${driftCashNames.length > 3 ? '…' : ''}.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Accounts',
        severity: 'warning',
        actionHint: 'Open Accounts — compare “transaction net” to current balance; add missing history or an opening-balance adjustment.',
      });
    }

    const hasMarketExposure =
      (getPersonalInvestments(data).length > 0 ||
        (data.watchlist ?? []).length > 0 ||
        getPersonalCommodityHoldings(data).length > 0);
    if (hasMarketExposure) {
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
      const staleSyms = getStaleQuoteSymbols(tracked, symbolQuoteUpdatedAt, isLive, {
        countMissingTimestampAsStale: !globalFresh,
      });
      if (isLive && staleSyms.length > 0) {
        push({
          id: 'market-symbols-stale',
          category: 'System',
          message: `Some symbols need a fresh quote: ${staleSyms.slice(0, 6).join(', ')}${staleSyms.length > 6 ? '…' : ''}.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Watchlist',
          severity: 'warning',
          actionHint: 'Refresh prices in the header; failed symbols may need a different data provider.',
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

    (data.plannedTrades ?? []).filter((p) => p.status === 'Planned').forEach((plan) => {
      const priceInfo = simulatedPrices?.[plan.symbol];
      if (!priceInfo) return;
      const targetVal = (plan as any).target_value ?? (plan as any).targetValue ?? 0;
      const tradeType = (plan as any).trade_type ?? plan.tradeType ?? 'buy';
      const triggered = (tradeType === 'buy' && priceInfo.price <= targetVal) || (tradeType === 'sell' && priceInfo.price >= targetVal);
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

    // Smart monthly digest (external expenses only, SAR-normalized per account currency)
    const accByIdRunway = new Map(accountsForRunway.map((a) => [a.id, a]));
    const monthlyExpensesByKey = new Map<string, number>();
    transactionsForRunway.forEach((t) => {
      if (!countsAsExpenseForCashflowKpi(t) || !t.date) return;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const cur = accByIdRunway.get(t.accountId)?.currency === 'USD' ? 'USD' : 'SAR';
      const add = toSAR(Math.abs(Number(t.amount) || 0), cur, sarPerUsd);
      monthlyExpensesByKey.set(key, (monthlyExpensesByKey.get(key) || 0) + add);
    });
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
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

    // Prioritize smarter, keep feed concise
    return list
      .sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 40);
  }, [data, simulatedPrices, lastUpdated, isLive, symbolQuoteUpdatedAt, exchangeRate, pendingBudgetRequestCount, pendingTransactionApprovalCount, isAdmin, auth?.user?.id, todosOpt?.todos]);

  const notificationsWithRead = useMemo(
    () => notifications.map((n) => ({ ...n, isRead: readIds.has(n.id) })),
    [notifications, readIds]
  );

  const unreadCount = useMemo(() => notificationsWithRead.filter((n) => !n.isRead).length, [notificationsWithRead]);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => new Set([...prev, id]));
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds(() => new Set(notifications.map((n) => n.id)));
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
