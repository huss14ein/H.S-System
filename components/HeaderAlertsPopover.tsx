import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useNotifications,
  type AppNotification,
  type NotificationCategory,
} from '../context/NotificationsContext';
import { BellIcon } from './icons/BellIcon';
import { BellAlertIcon } from './icons/BellAlertIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { TrophyIcon } from './icons/TrophyIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import {
  notificationRowSurface,
  notificationSeverityLabel,
  notificationSeverityPillClass,
} from '../utils/semanticAlertStyles';

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const severityRank = (s: AppNotification['severity']) =>
  s === 'urgent' ? 3 : s === 'warning' ? 2 : 1;

const CATEGORY_CHIPS: { id: NotificationCategory | 'All'; label: string }[] = [
  { id: 'All', label: 'All' },
  { id: 'Budget', label: 'Budget' },
  { id: 'Goal', label: 'Goals' },
  { id: 'Investment', label: 'Invest' },
  { id: 'Transaction', label: 'Cash' },
  { id: 'System', label: 'System' },
];

function categoryIcon(category: NotificationCategory, className: string) {
  switch (category) {
    case 'Budget':
      return <ExclamationTriangleIcon className={className} />;
    case 'Goal':
      return <TrophyIcon className={className} />;
    case 'Investment':
    case 'PriceAlert':
    case 'Plan':
      return <ArrowTrendingUpIcon className={className} />;
    case 'Transaction':
      return <CreditCardIcon className={className} />;
    default:
      return <BellAlertIcon className={className} />;
  }
}

function matchesCategory(n: AppNotification, chip: NotificationCategory | 'All'): boolean {
  if (chip === 'All') return true;
  if (chip === 'Investment') {
    return n.category === 'Investment' || n.category === 'PriceAlert' || n.category === 'Plan';
  }
  return n.category === chip;
}

type HeaderAlertsPopoverProps = {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenAlertsPage: () => void;
  onOpenNotification: (notification: AppNotification) => void;
  onPlaySound?: () => void;
  soundEnabled?: boolean;
};

const HeaderAlertsPopover: React.FC<HeaderAlertsPopoverProps> = ({
  isOpen,
  onToggle,
  onClose,
  onOpenAlertsPage,
  onOpenNotification,
  onPlaySound,
  soundEnabled,
}) => {
  const ctx = useNotifications();
  const notifications = ctx?.notifications ?? [];
  const unreadCount = ctx?.unreadCount ?? 0;

  const [readFilter, setReadFilter] = useState<'unread' | 'all'>('unread');
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | 'All'>('All');

  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.isRead);
    return {
      urgent: unread.filter((n) => n.severity === 'urgent').length,
      warning: unread.filter((n) => n.severity === 'warning').length,
      info: unread.filter((n) => n.severity !== 'urgent' && n.severity !== 'warning').length,
    };
  }, [notifications]);

  const filteredPreview = useMemo(() => {
    let list = [...notifications];
    if (readFilter === 'unread') list = list.filter((n) => !n.isRead);
    list = list.filter((n) => matchesCategory(n, categoryFilter));
    return list
      .sort((a, b) => {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        const ds = severityRank(b.severity) - severityRank(a.severity);
        if (ds !== 0) return ds;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      })
      .slice(0, 6);
  }, [notifications, readFilter, categoryFilter]);

  const handleToggle = useCallback(() => {
    if (soundEnabled && unreadCount > 0) onPlaySound?.();
    onToggle();
  }, [soundEnabled, unreadCount, onPlaySound, onToggle]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const hasUrgent = counts.urgent > 0;

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[55] bg-slate-900/20 backdrop-blur-[2px] sm:hidden"
          aria-label="Close alerts"
          onClick={onClose}
        />
      )}

      <button
        type="button"
        onClick={handleToggle}
        className={`relative p-2.5 rounded-2xl transition-all duration-200 border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          unreadCount > 0
            ? hasUrgent
              ? 'text-rose-700 bg-rose-50 border-rose-200/80 shadow-sm shadow-rose-100 hover:bg-rose-100/80'
              : 'text-primary bg-primary/5 border-primary/20 shadow-sm hover:bg-primary/10'
            : 'text-gray-400 border-transparent hover:text-primary hover:bg-gray-50'
        }`}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <BellIcon className={`h-6 w-6 ${hasUrgent && unreadCount > 0 ? 'animate-wiggle' : ''}`} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-[1.125rem] min-w-[1.125rem]">
            {hasUrgent && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
            )}
            <span
              className={`relative inline-flex rounded-full min-w-[1.125rem] h-[1.125rem] px-1 text-white text-[10px] items-center justify-center font-bold ${
                hasUrgent ? 'bg-rose-600' : 'bg-danger'
              }`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Alerts"
          className="fixed left-3 right-3 top-[4.25rem] z-[60] flex max-h-[min(32rem,calc(100vh-5.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-300/30 animate-fadeIn sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem] sm:max-w-[92vw]"
        >
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-primary/5 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900 tracking-tight">Alerts</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {unreadCount === 0
                    ? 'You’re caught up'
                    : `${unreadCount} need attention`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            {unreadCount > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {counts.urgent > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    {counts.urgent} urgent
                  </span>
                )}
                {counts.warning > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    {counts.warning} warning
                  </span>
                )}
                {counts.info > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900">
                    {counts.info} info
                  </span>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <div
                className="inline-flex rounded-lg bg-slate-100/90 p-0.5 text-[11px] font-semibold"
                role="tablist"
                aria-label="Read filter"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={readFilter === 'unread'}
                  onClick={() => setReadFilter('unread')}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    readFilter === 'unread' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Unread
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={readFilter === 'all'}
                  onClick={() => setReadFilter('all')}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    readFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  All
                </button>
              </div>
              {unreadCount > 0 && ctx?.markAllAsRead && (
                <button
                  type="button"
                  onClick={() => ctx.markAllAsRead()}
                  className="ml-auto text-[11px] font-semibold text-primary hover:text-secondary whitespace-nowrap"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
              {CATEGORY_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setCategoryFilter(chip.id)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-all ${
                    categoryFilter === chip.id
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-white/80 text-slate-600 ring-1 ring-slate-200/80 hover:bg-slate-50'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 min-h-0">
            {filteredPreview.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="rounded-full bg-slate-100 p-3 mb-3">
                  <CheckCircleIcon className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="text-sm font-semibold text-slate-800">Nothing here</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[14rem]">
                  {readFilter === 'unread'
                    ? 'No unread alerts in this filter. Try “All” or another category.'
                    : 'Alerts from budgets, goals, and data health will show up here.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5" role="list">
                {filteredPreview.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onOpenNotification(n)}
                      className={`w-full text-left rounded-xl px-2.5 py-2.5 transition-all hover:shadow-md hover:-translate-y-px active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${notificationRowSurface(
                        n.severity,
                        n.isRead,
                      )}`}
                    >
                      <div className="flex gap-2.5">
                        <div
                          className={`shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
                            n.severity === 'urgent'
                              ? 'bg-rose-100 text-rose-700'
                              : n.severity === 'warning'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {categoryIcon(n.category, 'h-4 w-4')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${notificationSeverityPillClass(
                                n.severity,
                              )}`}
                            >
                              {notificationSeverityLabel(n.severity)}
                            </span>
                            <span className="text-[10px] text-slate-500">{formatRelativeTime(n.date)}</span>
                            {!n.isRead && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                            )}
                          </div>
                          <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug">{n.message}</p>
                          {n.actionHint && (
                            <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{n.actionHint}</p>
                          )}
                          <p className="text-[10px] font-semibold text-primary mt-1.5">Open →</p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-3 py-2.5 flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenAlertsPage}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white text-sm font-semibold h-10 hover:bg-secondary transition-colors shadow-sm"
            >
              <BellIcon className="h-4 w-4 opacity-90" />
              View all alerts
            </button>
            <p className="text-[10px] text-center text-slate-400">Esc to close · click a row to jump there</p>
          </div>
        </div>
      )}
    </>
  );
};

export default HeaderAlertsPopover;
