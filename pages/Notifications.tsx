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
import LoadingSpinner from '../components/LoadingSpinner';
import { DemoDataButton } from '../components/DemoDataButton';

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
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!ctx) return [];
    let list = ctx.notifications;
    if (filter === 'Unread') list = list.filter((n) => !n.isRead);
    if (categoryFilter !== 'All') {
      if (categoryFilter === 'Investment') {
        list = list.filter((n) => n.category === 'Investment' || n.category === 'PriceAlert' || n.category === 'Plan');
      } else {
        list = list.filter((n) => n.category === categoryFilter);
      }
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((n) => `${n.message} ${n.actionHint || ''} ${n.symbol || ''}`.toLowerCase().includes(q));
    return list;
  }, [ctx, filter, categoryFilter, query]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<NotificationCategory | 'Other', AppNotification[]>();
    filtered.forEach((n) => {
      const key = n.category === 'PriceAlert' || n.category === 'Plan' ? 'Investment' : n.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const insights = useMemo(() => {
    const urgent = filtered.filter((n) => n.severity === 'urgent').length;
    const warning = filtered.filter((n) => n.severity === 'warning').length;
    const unread = filtered.filter((n) => !n.isRead).length;
    const top = [...filtered].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
    return { urgent, warning, unread, top };
  }, [filtered]);

  const handleNotificationClick = (n: AppNotification) => {
    ctx?.markAsRead(n.id);
    setActivePage(n.pageLink);
  };

  if (!ctx) {
    return (
      <PageLayout title="Notifications" action={<DemoDataButton page="Notifications" />}>
        <LoadingSpinner message="Loading…" />
      </PageLayout>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Enhanced Hero Section */}
      <div className="rounded-3xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-8 shadow-xl mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">🔔</span>
            </div>
            <div>
              <h2 className="text-3xl font-bold text-slate-900">Notifications</h2>
              <p className="text-lg text-slate-600 mt-2">
                {ctx.unreadCount > 0 ? `${ctx.unreadCount} unread • Smart automated feed` : 'All caught up'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-bold text-indigo-700 uppercase tracking-wider">Smart Feed</span>
          </div>
        </div>
        <div className="mt-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
          <p className="text-slate-700 leading-relaxed">
            Stay informed with intelligent notifications about your finances. Get alerts for budget limits, 
            goal milestones, investment opportunities, and important transactions.
          </p>
        </div>
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-rose-50 to-red-50 border-2 border-rose-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">📬</span>
            </div>
            <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-rose-800 uppercase tracking-wider mb-2">Unread</p>
          <p className="text-4xl font-black text-rose-900 tabular-nums">{insights.unread}</p>
          <p className="text-sm text-rose-600 mt-2">Pending alerts</p>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">⚠️</span>
            </div>
            <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-2">Urgent</p>
          <p className="text-4xl font-black text-amber-900 tabular-nums">{insights.urgent}</p>
          <p className="text-sm text-amber-600 mt-2">Immediate action</p>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-orange-50 border-2 border-orange-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">🔶</span>
            </div>
            <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-orange-800 uppercase tracking-wider mb-2">Warning</p>
          <p className="text-4xl font-black text-orange-900 tabular-nums">{insights.warning}</p>
          <p className="text-sm text-orange-600 mt-2">Attention needed</p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-3xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">📊</span>
            </div>
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          </div>
          <p className="text-sm font-bold text-blue-800 uppercase tracking-wider mb-2">Filtered</p>
          <p className="text-4xl font-black text-blue-900 tabular-nums">{filtered.length}</p>
          <p className="text-sm text-blue-600 mt-2">Total visible</p>
        </div>
      </div>

      {/* Enhanced Action Controls */}
      <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-8 shadow-lg mb-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-slate-500 to-slate-600 rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-lg">🎯</span>
          </div>
          <h3 className="text-xl font-bold text-slate-900">Quick Actions</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DemoDataButton page="Notifications" />
          {ctx.unreadCount > 0 && (
            <button type="button" onClick={ctx.markAllAsRead} className="h-12 px-6 text-sm border-2 border-indigo-300 text-indigo-700 rounded-xl hover:bg-indigo-50 transition-all duration-200 font-medium">
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Enhanced Main Content */}
      <div className="space-y-8">
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-4 mb-4">
        <p className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Smart notification center</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <SmallMetric label="Unread" value={String(insights.unread)} />
          <SmallMetric label="Urgent" value={String(insights.urgent)} />
          <SmallMetric label="Warning" value={String(insights.warning)} />
          <SmallMetric label="Filtered total" value={String(filtered.length)} />
        </div>
        {insights.top.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Top priorities</p>
            <div className="space-y-1">
              {insights.top.map((n) => (
                <button key={`top-${n.id}`} type="button" onClick={() => handleNotificationClick(n)} className="w-full text-left text-sm rounded border border-slate-200 bg-white px-2 py-1.5 hover:bg-slate-50">
                  {n.message}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4 mb-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications" className="input-base h-9 w-56 text-sm" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide self-center mr-2">Filter</span>
        {(['All', 'Unread'] as const).map((tab) => (
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
        {(['All', 'Budget', 'Goal', 'Transaction', 'Investment'] as const).map((cat) => (
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
                <div className="px-4 py-2 bg-gray-50/80 text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</div>
                <ul className="list-none">
                  {items.map((n) => (
                    <li key={n.id} className={`p-4 transition-colors hover:bg-gray-50/50 ${!n.isRead ? 'bg-white' : 'bg-gray-50/30'} ${severityStyles[n.severity ?? 'info']}`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 mt-0.5"><CategoryIcon category={n.category} /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${n.isRead ? 'text-gray-600' : 'font-medium text-dark'}`}>{n.message}</p>
                          {n.actionHint && <p className="text-xs text-slate-500 mt-1">Action: {n.actionHint}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(n.date)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => handleNotificationClick(n)} className="text-sm font-semibold text-primary hover:underline">View</button>
                          {!n.isRead && (
                            <button onClick={() => ctx.markAsRead(n.id)} title="Mark as read" className="p-1 rounded hover:bg-gray-200">
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
      </div>
    </div>
  );
};

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/80 bg-white/90 px-2 py-1.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export default Notifications;
