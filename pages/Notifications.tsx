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
import EmptyState from '../components/EmptyState';

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
    default: return <BellAlertIcon className={`${c} text-slate-500`} />;
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
    let list = ctx.notifications ?? [];
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
    if (n.pageLink) setActivePage(n.pageLink);
  };

  if (!ctx) {
    return (
      <PageLayout title="Notifications">
        <LoadingSpinner message="Loading…" />
      </PageLayout>
    );
  }

  return (
    <div className="page-container">
      {/* Hero Section */}
      <div className="section-card p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center">
              <span className="text-primary text-2xl">🔔</span>
            </div>
            <div>
              <h2 className="page-title text-2xl sm:text-3xl">Notifications</h2>
              <p className="text-slate-600 mt-1">
                {ctx.unreadCount > 0 ? `${ctx.unreadCount} unread • Smart automated feed` : 'All caught up'}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 bg-slate-50 rounded-xl p-6 border border-slate-200">
          <p className="text-slate-700 leading-relaxed">
            Stay informed with intelligent notifications about your finances. Get alerts for budget limits,
            goal milestones, investment opportunities, and important transactions.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="cards-grid grid grid-cols-1 sm:grid-cols-4">
        <div className="section-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Unread</p>
            <div className="w-10 h-10 bg-danger/10 rounded-xl flex items-center justify-center text-danger font-bold">📬</div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">{insights.unread}</p>
          <p className="text-sm text-slate-600 mt-1">Pending alerts</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Urgent</p>
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-700 font-bold text-sm">⚠</div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">{insights.urgent}</p>
          <p className="text-sm text-slate-600 mt-1">Immediate action</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Warning</p>
            <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center text-warning font-bold text-sm">!</div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">{insights.warning}</p>
          <p className="text-sm text-slate-600 mt-1">Attention needed</p>
        </div>
        <div className="section-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">Filtered</p>
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary font-bold text-sm">#</div>
          </div>
          <p className="text-2xl font-bold text-dark tabular-nums">{filtered.length}</p>
          <p className="text-sm text-slate-600 mt-1">Total visible</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="section-card">
        <h3 className="section-title">Quick Actions</h3>
        <div className="flex flex-wrap items-center gap-4">
          {ctx.unreadCount > 0 && (
            <button type="button" onClick={ctx.markAllAsRead} className="btn-ghost">
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
      <div className="section-card">
        <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Smart notification center</p>
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

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 mb-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications" className="input-base h-9 w-56 text-sm" />
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide self-center mr-2">Filter</span>
        {(['All', 'Unread'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              filter === tab ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide self-center ml-4 mr-2">Type</span>
        {(['All', 'Budget', 'Goal', 'Transaction', 'Investment'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              categoryFilter === cat ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-transparent'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <SectionCard title="Notifications" className="overflow-hidden p-0" collapsible collapsibleSummary="Alerts by category" defaultExpanded>
        {groupedByCategory.length === 0 ? (
          <EmptyState
            icon={<ClipboardDocumentListIcon className="w-12 h-12" />}
            title="No notifications"
            description="You're all caught up."
            action={setActivePage ? { label: 'Go to Dashboard', onClick: () => setActivePage('Dashboard') } : undefined}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {groupedByCategory.map(([category, items]) => (
              <div key={category}>
                <div className="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">{category}</div>
                <ul className="list-none">
                  {items.map((n) => (
                    <li key={n.id} className={`p-4 transition-colors hover:bg-slate-50/50 ${!n.isRead ? 'bg-white' : 'bg-slate-50/50'} ${severityStyles[n.severity ?? 'info']}`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 mt-0.5"><CategoryIcon category={n.category} /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${n.isRead ? 'text-slate-600' : 'font-medium text-dark'}`}>{n.message}</p>
                          {n.actionHint && <p className="text-xs text-slate-500 mt-1">Action: {n.actionHint}</p>}
                          <p className="text-xs text-slate-400 mt-0.5">{formatRelativeTime(n.date)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => handleNotificationClick(n)} className="text-sm font-semibold text-primary hover:underline">View</button>
                          {!n.isRead && (
                            <button onClick={() => ctx.markAsRead(n.id)} title="Mark as read" className="p-1 rounded hover:bg-slate-200">
                              <CheckCircleIcon className="h-5 w-5 text-slate-400 hover:text-green-500" />
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
