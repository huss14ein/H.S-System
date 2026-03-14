import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
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
  /** Optional: for price alerts, planned trades */
  symbol?: string;
  severity?: 'info' | 'warning' | 'urgent';
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
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids]));
  } catch (_) {}
}

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { data } = useContext(DataContext) ?? {};
  const { simulatedPrices } = useMarketData();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);

  useEffect(() => {
    saveReadIds(readIds);
  }, [readIds]);

  const notifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    if (!data) return list;
    const now = new Date();

    // Budgets: over threshold (e.g. 90%+)
    const threshold = data.settings?.budgetThreshold ?? 90;
    (data.budgets ?? []).forEach(b => {
      const spent = (b as any).spent ?? (b as any).used ?? 0;
      const limit = (b as any).limit ?? (b as any).amount ?? 1;
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      if (pct >= threshold) {
        list.push({
          id: `budget-${b.id}`,
          category: 'Budget',
          message: `"${b.category ?? 'Budget'}" is at ${pct.toFixed(0)}% of limit.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Budgets',
          severity: pct >= 100 ? 'urgent' : 'warning',
        });
      }
    });

    // Goals: at risk (optional: deadline within 30 days and underfunded)
    (data.goals ?? []).forEach(g => {
      const targetDate = (g as any).targetDate ?? (g as any).target_date;
      if (targetDate) {
        const d = new Date(targetDate);
        const daysLeft = Math.ceil((d.getTime() - now.getTime()) / 86400000);
        if (daysLeft <= 30 && daysLeft >= 0) {
          list.push({
            id: `goal-${g.id}`,
            category: 'Goal',
            message: `Goal "${g.name}" deadline is in ${daysLeft} days.`,
            date: now.toISOString(),
            isRead: false,
            pageLink: 'Goals',
            severity: daysLeft <= 7 ? 'urgent' : 'warning',
          });
        }
      }
    });

    // Pending transactions (review) — one notification for all pending
    const pendingTx = (data.transactions ?? []).filter(t => (t.status ?? 'Approved') === 'Pending');
    if (pendingTx.length > 0) {
      const latest = pendingTx.sort((a, b) => new Date((b as any).date ?? 0).getTime() - new Date((a as any).date ?? 0).getTime())[0];
      list.push({
        id: 'tx-pending-review',
        category: 'Transaction',
        message: `${pendingTx.length} transaction(s) need category review.`,
        date: (latest as any).date ?? now.toISOString(),
        isRead: false,
        pageLink: 'Transactions',
        severity: 'info',
      });
    }

    // Budget requests: finalized or rejected — notify user
    (data.budgetRequests ?? []).filter((r: { status: string }) => r.status === 'Finalized' || r.status === 'Rejected').forEach((req: { id: string; categoryName?: string; category_name?: string; status: string; updated_at?: string }) => {
      const label = req.categoryName ?? req.category_name ?? 'request';
      list.push({
        id: `budget-request-${req.id}`,
        category: 'Budget',
        message: req.status === 'Finalized' ? `Your budget request for "${label}" was approved.` : `Your budget request for "${label}" was rejected.`,
        date: (req as any).updated_at ?? now.toISOString(),
        isRead: false,
        pageLink: 'Budgets',
        severity: req.status === 'Finalized' ? 'info' : 'warning',
      });
    });

    // Price alerts triggered
    (data.priceAlerts ?? []).filter(a => a.status === 'triggered').forEach(a => {
      list.push({
        id: `price-${a.id}`,
        category: 'PriceAlert',
        message: `${a.symbol} has reached your target price.`,
        date: (a as any).createdAt ?? (a as any).created_at ?? now.toISOString(),
        isRead: false,
        pageLink: 'Investments',
        symbol: a.symbol,
        severity: 'urgent',
      });
    });

    // Planned trades: price condition met (ready to execute)
    (data.plannedTrades ?? []).filter(p => p.status === 'Planned').forEach(plan => {
      const priceInfo = simulatedPrices?.[plan.symbol];
      if (!priceInfo) return;
      const targetVal = (plan as any).target_value ?? (plan as any).targetValue ?? 0;
      const tradeType = (plan as any).trade_type ?? plan.tradeType ?? 'buy';
      const triggered = (tradeType === 'buy' && priceInfo.price <= targetVal) || (tradeType === 'sell' && priceInfo.price >= targetVal);
      if (triggered) {
        list.push({
          id: `plan-${plan.id}`,
          category: 'Plan',
          message: `Target met: ${tradeType.toUpperCase()} ${plan.name ?? plan.symbol} ready to execute.`,
          date: now.toISOString(),
          isRead: false,
          pageLink: 'Investments',
          symbol: plan.symbol,
          severity: 'urgent',
        });
      }
    });

    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return list;
  }, [data, simulatedPrices]);

  const notificationsWithRead = useMemo(() =>
    notifications.map(n => ({ ...n, isRead: readIds.has(n.id) })),
    [notifications, readIds]
  );

  const unreadCount = useMemo(() => notificationsWithRead.filter(n => !n.isRead).length, [notificationsWithRead]);

  const markAsRead = useCallback((id: string) => {
    setReadIds(prev => new Set([...prev, id]));
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds(() => new Set(notifications.map(n => n.id)));
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
