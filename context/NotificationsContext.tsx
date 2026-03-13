import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuthContext } from './AuthContext';
import { Page } from '../types';
import { DataContext } from './DataContext';
import { useMarketData } from './MarketDataContext';

const READ_STORAGE_KEY = 'h.s.notifications.read';

export type NotificationCategory = 'Budget' | 'Goal' | 'Investment' | 'Transaction' | 'PriceAlert' | 'Plan' | 'System';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  message: string;
  date: string;
  isRead: boolean;
  pageLink: Page;
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
  const { simulatedPrices } = useMarketData();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  const [pendingBudgetRequestCount, setPendingBudgetRequestCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => { saveReadIds(readIds); }, [readIds]);

  useEffect(() => {
    let alive = true;
    const loadPendingBudgetRequests = async () => {
      if (!supabase || !auth?.user?.id) {
        if (alive) setPendingBudgetRequestCount(0);
        return;
      }
      const { data: userRow } = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
      const adminStatus = String((userRow as any)?.role || '').toLowerCase() === 'admin';
      if (alive) setIsAdmin(adminStatus);
      let query = supabase.from('budget_requests').select('id', { count: 'exact', head: true }).eq('status', 'Pending');
      if (!adminStatus) query = query.eq('user_id', auth.user.id);
      const { count } = await query;
      if (alive) setPendingBudgetRequestCount(Number(count || 0));
    };

    loadPendingBudgetRequests();
    const timer = window.setInterval(loadPendingBudgetRequests, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
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
      push({
        id: `budget-${b.id}`,
        category: 'Budget',
        message: `"${b.category ?? 'Budget'}" is at ${pct.toFixed(0)}% of limit.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        severity: pct >= 100 ? 'urgent' : 'warning',
        actionHint: pct >= 100 ? 'Review and reduce spending or increase approved limit.' : 'Monitor this category and reduce optional spend.',
      });
    });

    // Goals near deadline
    (data.goals ?? []).forEach((g) => {
      const targetDate = (g as any).targetDate ?? (g as any).target_date;
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
          severity: daysLeft <= 7 ? 'urgent' : 'warning',
          actionHint: 'Increase monthly allocation or adjust goal deadline.',
        });
      }
    });

    // Transaction approval notifications - only for admins
    if (isAdmin) {
      const pendingTx = (data.transactions ?? []).filter((t) => (t.status ?? 'Approved') === 'Pending');
      if (pendingTx.length > 0) {
        push({
          id: 'tx-pending-review',
          category: 'Transaction',
          message: `${pendingTx.length} transaction(s) need approval.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Transactions',
          severity: pendingTx.length >= 5 ? 'urgent' : 'warning',
          actionHint: 'Open Transactions and review pending items.',
        });
      }
    }
    
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

    if (pendingBudgetRequestCount > 0) {
      push({
        id: 'budget-requests-pending',
        category: 'Budget',
        message: `${pendingBudgetRequestCount} budget request(s) are waiting for review.`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        severity: pendingBudgetRequestCount >= 3 ? 'urgent' : 'warning',
        actionHint: 'Finalize pending requests to keep budget workflow moving.',
      });
    }

    // Cash runway automation (checking+savings vs avg monthly expense)
    const liquidCash = (data.accounts ?? [])
      .filter((a: any) => a.type === 'Checking' || a.type === 'Savings')
      .reduce((sum: number, a: any) => sum + Math.max(0, Number(a.balance) || 0), 0);
    const monthlyExpensesByKey = new Map<string, number>();
    (data.transactions ?? []).forEach((t: any) => {
      if (t.type !== 'expense' || !t.date) return;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyExpensesByKey.set(key, (monthlyExpensesByKey.get(key) || 0) + Math.abs(Number(t.amount) || 0));
    });
    const monthlyExpenseValues = Array.from(monthlyExpensesByKey.values());
    const avgMonthlyExpense = monthlyExpenseValues.length > 0 ? monthlyExpenseValues.reduce((a, b) => a + b, 0) / monthlyExpenseValues.length : 0;
    const runwayMonths = avgMonthlyExpense > 0 ? liquidCash / avgMonthlyExpense : 0;
    if (avgMonthlyExpense > 0 && runwayMonths > 0 && runwayMonths < 2) {
      push({
        id: 'cash-runway-low',
        category: 'System',
        message: `Cash runway is low (${runwayMonths.toFixed(1)} months).`,
        date: now.toISOString(),
        isRead: false,
        pageLink: 'Accounts',
        severity: runwayMonths < 1 ? 'urgent' : 'warning',
        actionHint: 'Reduce discretionary expenses or increase income buffers.',
      });
    }

    // Price alerts triggered
    (data.priceAlerts ?? []).filter((a) => a.status === 'triggered').forEach((a) => {
      push({
        id: `price-${a.id}`,
        category: 'PriceAlert',
        message: `${a.symbol} has reached your target price.`,
        date: (a as any).createdAt ?? (a as any).created_at ?? now.toISOString(),
        isRead: false,
        pageLink: 'Investments',
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
          symbol: plan.symbol,
          severity: 'urgent',
          actionHint: 'Open Investments and execute or reschedule this plan.',
        });
      }
    });

    // Smart monthly digest
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
        actionHint: 'Open Plan to inspect categories driving the spike.',
      });
    }

    // Prioritize smarter, keep feed concise
    return list
      .sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 40);
  }, [data, simulatedPrices, pendingBudgetRequestCount, isAdmin]);

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
