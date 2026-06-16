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
import { ChevronRightIcon } from './icons/ChevronRightIcon';
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

function iconTileClass(severity: AppNotification['severity']): string {
  if (severity === 'urgent') return 'bg-rose-100 text-rose-700 ring-rose-200/60';
  if (severity === 'warning') return 'bg-amber-100 text-amber-800 ring-amber-200/60';
  return 'bg-sky-100 text-sky-800 ring-sky-200/60';
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
          className="fixed inset-0 z-[55] bg-slate-900/25 backdrop-blur-[1px] sm:hidden"
          aria-label="Close alerts"
          onClick={onClose}
        />
      )}

      <button
        type="button"
        onClick={handleToggle}
        className={`relative flex items-center justify-center p-2 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          unreadCount > 0
            ? hasUrgent
              ? 'text-rose-700 bg-rose-50 hover:bg-rose-100/90 ring-1 ring-rose-200/70'
              : 'text-primary bg-primary/5 hover:bg-primary/10 ring-1 ring-primary/15'
            : 'text-gray-400 hover:text-primary hover:bg-gray-50'
        }`}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <BellIcon className={`h-6 w-6 ${hasUrgent && unreadCount > 0 ? 'motion-safe:animate-pulse text-amber-600' : ''}`} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-[1rem]">
            {hasUrgent && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-50" />
            )}
            <span
              className={`relative inline-flex rounded-full min-w-[1rem] h-4 px-1 text-white text-[10px] items-center justify-center font-bold leading-none ${
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
          className="fixed left-3 right-3 top-[4.25rem] z-[60] flex max-h-[min(28rem,calc(100vh-5.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 animate-fadeIn sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22.5rem] sm:max-w-[min(22.5rem,calc(100vw-1.5rem))]"
        >
          {/* Header */}
          <div className="shrink-0 border-b border-slate-100 px-4 pt-3.5 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight leading-tight">Alerts</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {unreadCount === 0 ? 'You’re caught up' : `${unreadCount} need attention`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 p-2 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>

            {unreadCount > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {counts.urgent > 0 && (
                  <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-center ring-1 ring-rose-100">
                    <p className="text-lg font-bold tabular-nums text-rose-700 leading-none">{counts.urgent}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 mt-0.5">Urgent</p>
                  </div>
                )}
                {counts.warning > 0 && (
                  <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-center ring-1 ring-amber-100">
                    <p className="text-lg font-bold tabular-nums text-amber-800 leading-none">{counts.warning}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mt-0.5">Warning</p>
                  </div>
                )}
                {counts.info > 0 && (
                  <div className="rounded-lg bg-sky-50 px-2 py-1.5 text-center ring-1 ring-sky-100">
                    <p className="text-lg font-bold tabular-nums text-sky-800 leading-none">{counts.info}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mt-0.5">Info</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <div
                className="inline-flex flex-1 min-w-0 rounded-lg bg-slate-100 p-0.5"
                role="tablist"
                aria-label="Read filter"
              >
                {(['unread', 'all'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={readFilter === tab}
                    onClick={() => setReadFilter(tab)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                      readFilter === tab
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab === 'unread' ? 'Unread' : 'All'}
                  </button>
                ))}
              </div>
              {unreadCount > 0 && ctx?.markAllAsRead && (
                <button
                  type="button"
                  onClick={() => ctx.markAllAsRead()}
                  className="shrink-0 text-xs font-semibold text-primary hover:text-secondary whitespace-nowrap px-1"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {CATEGORY_CHIPS.map((chip) => {
                const active = categoryFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setCategoryFilter(chip.id)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                      active
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/90 hover:bg-slate-100'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 min-h-0">
            {filteredPreview.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="rounded-full bg-emerald-50 p-3 mb-3 ring-1 ring-emerald-100">
                  <CheckCircleIcon className="h-7 w-7 text-emerald-600" />
                </div>
                <p className="text-sm font-semibold text-slate-800">Nothing here</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[15rem] leading-relaxed">
                  {readFilter === 'unread'
                    ? 'No unread alerts in this filter. Try “All” or another category.'
                    : 'Budget, goal, and data-health alerts will appear here.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-2" role="list">
                {filteredPreview.map((n) => (
                  <li key={n.id}>
                    <div
                      className={`group w-full text-left rounded-xl transition-all hover:shadow-sm focus-within:ring-2 focus-within:ring-primary/30 ${notificationRowSurface(
                        n.severity,
                        n.isRead,
                      )}`}
                    >
                      <div className="flex items-stretch gap-3 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenNotification(n)}
                          className="flex flex-1 items-stretch gap-3 min-w-0 text-left focus:outline-none"
                        >
                          <div
                            className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${iconTileClass(
                              n.severity,
                            )}`}
                          >
                            {categoryIcon(n.category, 'h-[1.125rem] w-[1.125rem]')}
                          </div>
                          <div className="min-w-0 flex-1 flex flex-col justify-center">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span
                                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none ${notificationSeverityPillClass(
                                  n.severity,
                                )}`}
                              >
                                {notificationSeverityLabel(n.severity)}
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[11px] text-slate-500 tabular-nums leading-none">
                                  {formatRelativeTime(n.date)}
                                </span>
                                {!n.isRead && (
                                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />
                                )}
                              </span>
                            </div>
                            <p className="text-[13px] font-medium text-slate-800 line-clamp-2 leading-snug pr-1">
                              {n.message}
                            </p>
                            {n.actionHint && (
                              <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                                {n.actionHint}
                              </p>
                            )}
                          </div>
                        </button>
                        {!n.isRead && ctx?.markAsRead && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              ctx.markAsRead(n.id);
                            }}
                            className="shrink-0 self-center p-2 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            aria-label="Mark as read"
                            title="Mark as read"
                          >
                            <CheckCircleIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenNotification(n)}
                          className="shrink-0 self-center p-1 rounded-lg text-slate-300 hover:text-primary hover:bg-primary/5 transition-colors focus:outline-none"
                          aria-label="Open alert"
                        >
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-slate-100 px-3 py-3 bg-slate-50/60">
            <button
              type="button"
              onClick={onOpenAlertsPage}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white text-sm font-semibold h-10 hover:bg-secondary transition-colors shadow-sm"
            >
              <BellIcon className="h-4 w-4 opacity-90" />
              View all alerts
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-2 leading-relaxed">
              Esc to close · ✓ dismiss · row opens alert
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default HeaderAlertsPopover;
