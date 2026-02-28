import React, { useState, useMemo } from 'react';
import { Page } from '../types';
import { useNotifications, AppNotification, NotificationCategory } from '../context/NotificationsContext';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { BellAlertIcon } from '../components/icons/BellAlertIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { CreditCardIcon } from '../components/icons/CreditCardIcon';
import { ArrowTrendingUpIcon } from '../components/icons/ArrowTrendingUpIcon';
import { ClipboardDocumentListIcon } from '../components/icons/ClipboardDocumentListIcon';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString();
}

const CategoryIcon: React.FC<{ category: NotificationCategory }> = ({ category }) => {
  const c = 'h-6 w-6';
  switch (category) {
    case 'Budget': return <ExclamationTriangleIcon className={`${c} text-amber-500`} />;
    case 'Goal': return <TrophyIcon className={`${c} text-blue-500`} />;
    case 'Investment':
    case 'PriceAlert':
    case 'Plan': return <ArrowTrendingUpIcon className={`${c} text-violet-500`} />;
    case 'Transaction': return <CreditCardIcon className={`${c} text-slate-500`} />;
    default: return <BellAlertIcon className={`${c} text-gray-500`} />;
  }
};

const severityStyles: Record<string, string> = {
  urgent: 'border-l-4 border-red-500 bg-red-50/50',
  warning: 'border-l-4 border-amber-500 bg-amber-50/30',
  info: 'border-l-4 border-blue-500 bg-blue-50/30',
};

const Notifications: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
  const ctx = useNotifications();
  const [filter, setFilter] = useState<'All' | 'Unread'>('All');
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | 'All'>('All');

  const filtered = useMemo(() => {
    if (!ctx) return [];
    let list = ctx.notifications;
    if (filter === 'Unread') list = list.filter(n => !n.isRead);
    if (categoryFilter !== 'All') {
      if (categoryFilter === 'Investment') {
        list = list.filter(n => n.category === 'Investment' || n.category === 'PriceAlert' || n.category === 'Plan');
      } else {
        list = list.filter(n => n.category === categoryFilter);
      }
    }
    return list;
  }, [ctx, filter, categoryFilter]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<NotificationCategory | 'Other', AppNotification[]>();
    filtered.forEach(n => {
      const key = n.category === 'PriceAlert' || n.category === 'Plan' ? 'Investment' : n.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const handleNotificationClick = (n: AppNotification) => {
    ctx?.markAsRead(n.id);
    setActivePage(n.pageLink);
  };

  if (!ctx) {
    return (
      <PageLayout title="Notifications">
        <p className="text-slate-500">Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Notifications"
      description={ctx.unreadCount > 0 ? `${ctx.unreadCount} unread` : 'All caught up'}
      action={ctx.unreadCount > 0 ? (
        <button
          type="button"
          onClick={ctx.markAllAsRead}
          className="btn-outline text-sm"
        >
          Mark all as read
        </button>
      ) : undefined}
    >
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4 mb-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide self-center mr-2">Filter</span>
        {(['All', 'Unread'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              filter === tab ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide self-center ml-4 mr-2">Type</span>
        {(['All', 'Budget', 'Goal', 'Transaction', 'Investment'] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              categoryFilter === cat ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-transparent'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <SectionCard className="overflow-hidden p-0">
        {groupedByCategory.length === 0 ? (
          <div className="empty-state p-12">
            <ClipboardDocumentListIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="font-medium">No notifications</p>
            <p className="text-sm text-gray-400 mt-1">You're all caught up.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {groupedByCategory.map(([category, items]) => (
              <div key={category}>
                <div className="px-4 py-2 bg-gray-50/80 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {category}
                </div>
                <ul className="list-none">
                  {items.map(n => (
                    <li
                      key={n.id}
                      className={`p-4 transition-colors hover:bg-gray-50/50 ${!n.isRead ? 'bg-white' : 'bg-gray-50/30'} ${severityStyles[n.severity ?? 'info']}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 mt-0.5">
                          <CategoryIcon category={n.category} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${n.isRead ? 'text-gray-600' : 'font-medium text-dark'}`}>
                            {n.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(n.date)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleNotificationClick(n)}
                            className="text-sm font-semibold text-primary hover:underline"
                          >
                            View
                          </button>
                          {!n.isRead && (
                            <button
                              onClick={() => ctx.markAsRead(n.id)}
                              title="Mark as read"
                              className="p-1 rounded hover:bg-gray-200"
                            >
                              <CheckCircleIcon className="h-5 w-5 text-gray-400 hover:text-green-500" />
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageLayout>
  );
};

export default Notifications;
