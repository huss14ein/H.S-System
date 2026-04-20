import React, { useState, useContext, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Page, TradeCurrency, Account } from '../types';
import { NAVIGATION_ITEMS, PAGE_DISPLAY_NAMES } from '../constants';
import { HSLogo } from './icons/HSLogo';
import { AuthContext } from '../context/AuthContext';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { BellIcon } from './icons/BellIcon';
import { useCurrency } from '../context/CurrencyContext';
import { DataContext } from '../context/DataContext';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import useClickOutside from '../hooks/useClickOutside';
import { Bars3Icon } from './icons/Bars3Icon';
import { XMarkIcon } from './icons/XMarkIcon';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { CheckIcon } from './icons/CheckIcon';
import { useMarketData } from '../context/MarketDataContext';
import { useNotifications } from '../context/NotificationsContext';
import { useTodosOptional } from '../context/TodosContext';
import { ClipboardDocumentListIcon } from './icons/ClipboardDocumentListIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { usePrivacyMask } from '../context/PrivacyContext';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { inferInvestmentTransactionCurrency } from '../utils/investmentLedgerCurrency';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { isSupportedPageAction } from '../utils/pageActions';
import { INFOHINT_CLOSE_OTHERS } from './infoHintEvents';
interface HeaderProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
  onOpenLiveAdvisor: () => void;
  onOpenCommandPalette?: () => void;
  triggerPageActionPair?: (page: Page, action: string) => void;
}

const Header: React.FC<HeaderProps> = ({ activePage, setActivePage, onOpenLiveAdvisor, onOpenCommandPalette, triggerPageActionPair }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [isNotificationsPreviewOpen, setIsNotificationsPreviewOpen] = useState(false);
  const [isTasksPreviewOpen, setIsTasksPreviewOpen] = useState(false);
  
  const auth = useContext(AuthContext);
  const { data } = useContext(DataContext)!;
  const { currency, setCurrency, exchangeRate } = useCurrency();
  const { refreshPrices, isRefreshing, lastUpdated, isLive } = useMarketData();
  const [pricesStatusLabel, setPricesStatusLabel] = useState('');
  const lastUpdatedRef = useRef(lastUpdated);
  lastUpdatedRef.current = lastUpdated;
  useEffect(() => {
    if (!lastUpdated) {
      setPricesStatusLabel(isLive ? 'Live prices' : 'Simulated prices');
      return;
    }
    const formatRel = (at: Date) => {
      const s = Math.floor((Date.now() - at.getTime()) / 1000);
      return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    setPricesStatusLabel(isLive ? `Live · ${formatRel(lastUpdated)}` : `Simulated · ${formatRel(lastUpdated)}`);
    const t = setInterval(() => {
      const at = lastUpdatedRef.current;
      if (!at) return;
      setPricesStatusLabel(isLive ? `Live · ${formatRel(at)}` : `Simulated · ${formatRel(at)}`);
    }, 10000);
    return () => clearInterval(t);
  }, [lastUpdated, isLive]);
  
  const profileRef = useClickOutside<HTMLDivElement>(() => setIsProfileOpen(false));
  const currencyRef = useClickOutside<HTMLDivElement>(() => setIsCurrencyOpen(false));
  const navRef = useClickOutside<HTMLDivElement>(() => setActiveGroup(null));
  const notificationsPreviewRef = useClickOutside<HTMLDivElement>(() => setIsNotificationsPreviewOpen(false));
  const tasksPreviewRef = useClickOutside<HTMLDivElement>(() => setIsTasksPreviewOpen(false));

  const notificationsContext = useNotifications();
  const notificationCount = notificationsContext?.unreadCount ?? 0;
  const todosOpt = useTodosOptional();
  const todoActive = todosOpt?.activeCount ?? 0;
  const todoOverdue = todosOpt?.overdueCount ?? 0;
  const { playNotificationSound: soundEnabled } = usePrivacyMask();

  const prevNotificationCountRef = useRef(notificationCount);
  const playBeepRef = useRef(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (_) {}
  });

  useEffect(() => {
    if (
      soundEnabled &&
      notificationCount > prevNotificationCountRef.current &&
      prevNotificationCountRef.current >= 0
    ) {
      playBeepRef.current();
    }
    prevNotificationCountRef.current = notificationCount;
  }, [notificationCount, soundEnabled]);

  const openAlertsPage = () => {
    setIsNotificationsPreviewOpen(false);
    setIsTasksPreviewOpen(false);
    if (soundEnabled && notificationCount > 0) playBeepRef.current();
    if (triggerPageActionPair) triggerPageActionPair('Notifications', 'notifications-tab:alerts');
    else setActivePage('Notifications');
  };
  const openNotificationTarget = (notification: { id: string; pageLink: Page; pageAction?: string }) => {
    setIsNotificationsPreviewOpen(false);
    setIsTasksPreviewOpen(false);
    notificationsContext?.markAsRead(notification.id);
    if (triggerPageActionPair && notification.pageAction && isSupportedPageAction(notification.pageLink, notification.pageAction)) {
      triggerPageActionPair(notification.pageLink, notification.pageAction);
    } else {
      setActivePage(notification.pageLink);
    }
  };

  const openTasksPage = () => {
    setIsNotificationsPreviewOpen(false);
    setIsTasksPreviewOpen(false);
    if (triggerPageActionPair) triggerPageActionPair('Notifications', 'notifications-tab:tasks');
    else setActivePage('Notifications');
  };

  const topNotificationPreview = useMemo(() => {
    const list = notificationsContext?.notifications ?? [];
    return [...list]
      .sort((a, b) => {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      })
      .slice(0, 4);
  }, [notificationsContext?.notifications]);

  const topTasksPreview = useMemo(() => {
    const todos = todosOpt?.todos ?? [];
    return [...todos]
      .filter((t) => t.status === 'open')
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        if (a.priority !== b.priority) {
          const rank = { high: 0, medium: 1, low: 2 } as const;
          return rank[a.priority] - rank[b.priority];
        }
        return a.title.localeCompare(b.title);
      })
      .slice(0, 4);
  }, [todosOpt?.todos]);

  const navGroups = useMemo(() => [
    { name: 'Overview', items: ['Dashboard', 'Summary', 'Analysis', 'Forecast'] },
    { name: 'Management', items: ['Transactions', 'Statement Upload', 'Accounts', 'Budgets', 'Goals', 'Zakat'] },
    {
      name: 'Strategy',
      items: [
        'Investments',
        'Engines & Tools',
        'Market Events',
        'Plan',
        'Liabilities',
        'Assets',
      ],
    },
    { name: 'System', items: ['Notifications', 'Settings', 'System & APIs Health'] }
  ], []);

  const investmentProgress = useMemo(() => {
    if (!data?.investmentPlan) return { percent: 0, amount: 0, target: 0 };
    const sarPerUsd = resolveSarPerUsd(data, exchangeRate);
    const plan = data.investmentPlan;
    const planCurrency: TradeCurrency = (plan.budgetCurrency as TradeCurrency) || 'SAR';
    const convertAmount = (amount: number, from: TradeCurrency, to: TradeCurrency) => {
      if (!Number.isFinite(amount) || amount <= 0) return 0;
      if (from === to) return amount;
      if (from === 'USD' && to === 'SAR') return amount * sarPerUsd;
      if (from === 'SAR' && to === 'USD') return amount / sarPerUsd;
      return amount;
    };
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const personalAccountIds = new Set(getPersonalAccounts(data).map((a: Account) => a.id));
    const accounts = data?.accounts ?? [];
    const investments = getPersonalInvestments(data);
    const monthlyInvested = (data?.investmentTransactions ?? [])
      .filter((t) => {
        const aid = t.accountId ?? (t as { account_id?: string }).account_id ?? '';
        if (!aid || !personalAccountIds.has(aid)) return false;
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'buy';
      })
      .reduce((sum, t) => {
        const c = inferInvestmentTransactionCurrency(t, accounts, investments);
        return sum + convertAmount(t.total ?? 0, c, planCurrency);
      }, 0);
    const target = Math.max(0, Number(plan?.monthlyBudget) || 0);
    return {
      percent: target > 0 ? Math.min((monthlyInvested / target) * 100, 100) : 0,
      amount: monthlyInvested,
      target,
    };
  }, [data, exchangeRate]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('mobile-menu-open', isMobileMenuOpen);
    if (isMobileMenuOpen) {
      window.dispatchEvent(new CustomEvent(INFOHINT_CLOSE_OTHERS, { detail: { except: '__none__' } }));
    }
    return () => {
      document.body.classList.remove('mobile-menu-open');
    };
  }, [isMobileMenuOpen]);

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
      <div className="max-w-screen-2xl mx-auto">
        {/* Top Bar */}
        <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setActivePage('Dashboard')}>
              <HSLogo className="h-8 w-8 text-primary" />
              <h1 className="text-lg sm:text-xl font-bold text-dark tracking-tight">Finova</h1>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-1" ref={navRef}>
              {navGroups.map(group => {
                const isGroupActive = group.items.includes(activePage);
                return (
                  <div key={group.name} className="relative group">
                    <button
                      onClick={() => setActiveGroup(activeGroup === group.name ? null : group.name)}
                      className={`px-4 py-2 text-sm font-medium rounded-xl transition-all flex items-center space-x-1 ${
                        isGroupActive ? 'text-primary bg-primary/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      <span>{group.name}</span>
                      <ChevronDownIcon className={`h-4 w-4 opacity-50 transition-transform duration-200 ${activeGroup === group.name ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {activeGroup === group.name && (
                      <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-2xl shadow-2xl py-2 ring-1 ring-black ring-opacity-5 border border-gray-100 animate-fadeIn">
                        {group.items.map(itemName => {
                          const navItem = NAVIGATION_ITEMS.find(n => n.name === itemName);
                          if (!navItem) return null;
                          return (
                            <button
                              key={itemName}
                              onClick={() => { setActivePage(itemName as Page); setActiveGroup(null); }}
                              className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors ${
                                activePage === itemName ? 'text-primary bg-primary/5 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              <navItem.icon className={`mr-3 h-5 w-5 ${activePage === itemName ? 'text-primary' : 'text-gray-400'}`} />
                              {PAGE_DISPLAY_NAMES[itemName as Page] ?? itemName}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center space-x-3">
            {/* Investment Plan Quick Status */}
            <div 
              className="hidden xl:flex flex-col items-end mr-4 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setActivePage('Investments')}
              title={investmentProgress.target > 0 ? `Invested ${investmentProgress.amount.toLocaleString()} of ${investmentProgress.target.toLocaleString()} this month` : 'Set monthly budget in Investments → Monthly Plan'}
            >
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Monthly Plan</span>
                <span className="text-xs font-bold text-primary">
                  {investmentProgress.target > 0 ? `${investmentProgress.percent.toFixed(0)}%` : '—'}
                </span>
              </div>
              <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-1000" 
                  style={{ width: `${investmentProgress.target > 0 ? investmentProgress.percent : 0}%` }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-1 sm:space-x-2">
              <div className="hidden sm:flex flex-col items-end mr-2 min-w-[126px]">
                <button 
                  onClick={refreshPrices} 
                  disabled={isRefreshing}
                  className={`p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-gray-50 transition-all flex items-center justify-end gap-2 w-full ${isRefreshing ? 'animate-pulse' : ''}`}
                  title={isLive ? (lastUpdated ? `Live prices · Updated ${pricesStatusLabel.split('·')[1] ?? 'recently'}. Click to refresh.` : 'Live prices. Click to refresh.') : 'Simulated prices. Click to fetch live prices.'}
                >
                  <ArrowPathIcon className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <div className="flex flex-col items-end text-right leading-tight">
                    <span className="text-[10px] font-bold uppercase tracking-widest hidden xl:block">Refresh Prices</span>
                    <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded hidden xl:flex ${isLive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`} title={isLive ? 'Live market data' : 'Simulated (no API)'}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500' : 'bg-amber-500'}`} />
                      {isLive ? 'Live' : 'Simulated'}
                    </span>
                  </div>
                </button>
                {pricesStatusLabel && (
                  <span className="text-[10px] text-gray-400 mt-0.5 px-2 hidden xl:block text-right leading-tight" title={lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}>
                    {isRefreshing ? 'Updating…' : pricesStatusLabel}
                  </span>
                )}
              </div>

              <div className="relative hidden sm:block" ref={currencyRef}>
                <button onClick={() => setIsCurrencyOpen(!isCurrencyOpen)} className="flex items-center text-sm font-semibold text-gray-500 hover:text-primary px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all">
                  {currency}
                  <ChevronDownIcon className="h-4 w-4 ml-1 opacity-50" />
                </button>
                {isCurrencyOpen && (
                  <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-xl py-1.5 ring-1 ring-black ring-opacity-5 border border-gray-100">
                    <button onClick={() => { setCurrency('SAR'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">
                      SAR {currency === 'SAR' && <CheckIcon className="h-4 w-4 text-primary" />}
                    </button>
                    <button onClick={() => { setCurrency('USD'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">
                      USD {currency === 'USD' && <CheckIcon className="h-4 w-4 text-primary" />}
                    </button>
                  </div>
                )}
              </div>
              
              <div className="relative" ref={tasksPreviewRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsNotificationsPreviewOpen(false);
                    setIsTasksPreviewOpen((v) => !v);
                  }}
                  className="relative flex p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-gray-50 transition-all"
                  title={todoOverdue > 0 ? `${todoOverdue} overdue tasks` : 'My tasks'}
                  aria-label={`My tasks${todoActive > 0 ? `, ${todoActive} open` : ''}`}
                  aria-expanded={isTasksPreviewOpen}
                >
                  <ClipboardDocumentListIcon className="h-6 w-6" />
                  {todoActive > 0 && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 min-w-[1rem] px-0.5">
                      <span
                        className={`relative inline-flex rounded-full min-w-[1rem] h-4 px-1 text-white text-[10px] items-center justify-center font-bold ${
                          todoOverdue > 0 ? 'bg-rose-500' : 'bg-primary'
                        }`}
                      >
                        {todoActive > 99 ? '99+' : todoActive}
                      </span>
                    </span>
                  )}
                </button>
                {isTasksPreviewOpen && (
                  <div className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] rounded-2xl border border-slate-200 bg-white shadow-2xl z-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-slate-800">Task preview</p>
                      <span className="text-[11px] text-slate-500">{todoActive} open</span>
                    </div>
                    {topTasksPreview.length === 0 ? (
                      <p className="text-xs text-slate-500">No open tasks. You’re all caught up.</p>
                    ) : (
                      <ul className="space-y-2">
                        {topTasksPreview.map((t) => (
                          <li key={t.id} className="rounded-lg border border-slate-100 px-2.5 py-2 bg-slate-50/40">
                            <p className="text-sm text-slate-700 line-clamp-2">{t.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {t.dueDate ? `Due ${t.dueDate}` : 'No due date'}{t.priority ? ` · ${t.priority}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={openTasksPage}
                      className="mt-3 w-full inline-flex items-center justify-center rounded-lg bg-primary text-white text-sm font-semibold leading-none h-10 hover:bg-secondary"
                    >
                      View all tasks
                    </button>
                  </div>
                )}
              </div>

              <div className="relative" ref={notificationsPreviewRef}>
                <button
                  onClick={() => {
                    if (soundEnabled && notificationCount > 0) playBeepRef.current();
                    setIsTasksPreviewOpen(false);
                    setIsNotificationsPreviewOpen((v) => !v);
                  }}
                  className={`relative p-2.5 rounded-2xl transition-all border ${
                    notificationCount > 0
                      ? 'text-primary bg-primary/5 border-primary/20 shadow-sm hover:bg-primary/10'
                      : 'text-gray-400 border-transparent hover:text-primary hover:bg-gray-50'
                  }`}
                  aria-label={`Notifications${notificationCount > 0 ? `, ${notificationCount} unread` : ''}`}
                  aria-expanded={isNotificationsPreviewOpen}
                >
                    <BellIcon className="h-6 w-6" />
                    {notificationCount > 0 && (
                        <span className="absolute top-2 right-2 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-danger text-white text-[10px] items-center justify-center font-bold">{notificationCount}</span>
                        </span>
                    )}
                </button>
                {isNotificationsPreviewOpen && (
                  <div className="absolute right-0 mt-2 w-[24rem] max-w-[90vw] rounded-2xl border border-slate-200 bg-white shadow-2xl z-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-slate-800">Alerts preview</p>
                      <span className="text-[11px] text-slate-500">{notificationCount} unread</span>
                    </div>
                    {topNotificationPreview.length === 0 ? (
                      <p className="text-xs text-slate-500">No alerts right now.</p>
                    ) : (
                      <ul className="space-y-2">
                        {topNotificationPreview.map((n) => (
                          <li key={n.id} className={`rounded-lg border px-2.5 py-2 ${n.isRead ? 'border-slate-100 bg-slate-50/40' : 'border-primary/20 bg-primary/5'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm text-slate-700 line-clamp-2">{n.message}</p>
                                {n.actionHint && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.actionHint}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => openNotificationTarget(n)}
                                className="shrink-0 text-[11px] font-semibold leading-none text-primary hover:underline"
                                aria-label="Open alert target"
                              >
                                Open
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={openAlertsPage}
                      className="mt-3 w-full inline-flex items-center justify-center rounded-lg bg-primary text-white text-sm font-semibold leading-none h-10 hover:bg-secondary"
                    >
                      View all alerts
                    </button>
                  </div>
                )}
              </div>

              {onOpenCommandPalette && (
                <button
                  type="button"
                  onClick={onOpenCommandPalette}
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-primary hover:bg-slate-100 border border-slate-200 transition-all"
                  title="Search pages & quick actions"
                  aria-label="Open command palette (⌘K)"
                >
                  <span className="opacity-80">⌘K</span>
                </button>
              )}
              <button
                onClick={onOpenLiveAdvisor}
                className="p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-gray-50 disabled:text-gray-200 transition-all"
              >
                 <HeadsetIcon className="h-6 w-6" />
             </button>
              
              <div className="h-8 w-px bg-gray-100 mx-1 hidden sm:block"></div>

              <div className="relative" ref={profileRef}>
                  <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="flex items-center space-x-2 p-1 rounded-xl text-gray-500 hover:bg-gray-50 transition-all">
                      <UserCircleIcon className="h-8 w-8 text-gray-400" />
                      <ChevronDownIcon className={`h-4 w-4 opacity-50 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isProfileOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl py-2 ring-1 ring-black ring-opacity-5 border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-gray-100">
                        <p className="text-sm font-bold text-gray-900 break-all leading-snug">{auth?.user?.email}</p>
                        <p className="text-gray-500 text-[10px] font-mono mt-0.5 opacity-60 break-all">{auth?.user?.id}</p>
                      </div>
                      <div className="py-1">
                        <button onClick={() => { setActivePage('Settings'); setIsProfileOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">Settings</button>
                      </div>
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button onClick={auth?.logout} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors font-medium">Logout</button>
                      </div>
                  </div>
                  )}
              </div>

              <div className="lg:hidden">
                <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-50">
                  <Bars3Icon className="h-6 w-6" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Mobile menu: portal to document.body so main content (later in DOM) cannot paint above it — fixes stray InfoHint icons bleeding through. */}
      {typeof document !== 'undefined' &&
        isMobileMenuOpen &&
        createPortal(
          <div className="fixed inset-0 z-[9997] bg-white lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="px-4 pt-4 flex justify-between items-center border-b border-gray-100 pb-4">
              <div className="flex items-center space-x-2">
                <HSLogo className="h-8 w-8 text-primary" />
                <h1 className="text-xl font-bold text-dark">Finova</h1>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
                aria-label="Close menu"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="mt-4 px-4 space-y-6 overflow-y-auto h-[calc(100vh-80px)] pb-12">
              {navGroups.map((group) => (
                <div key={group.name} className="animate-fadeIn" style={{ animationDelay: '100ms' }}>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-3">{group.name}</h3>
                  <div className="grid grid-cols-1 gap-1">
                    {group.items.map((itemName) => {
                      const navItem = NAVIGATION_ITEMS.find((n) => n.name === itemName);
                      if (!navItem) return null;
                      const isActive = activePage === itemName;
                      return (
                        <button
                          key={itemName}
                          type="button"
                          onClick={() => {
                            setActivePage(itemName as Page);
                            setIsMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center px-4 py-3.5 text-sm font-semibold rounded-2xl transition-all ${
                            isActive ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <navItem.icon className={`mr-4 h-5 w-5 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                          {PAGE_DISPLAY_NAMES[itemName as Page] ?? itemName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="pt-6 border-t border-gray-100">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-3">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      refreshPrices();
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors relative"
                  >
                    <ArrowPathIcon className={`h-6 w-6 text-gray-500 mb-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span className="text-xs font-bold text-gray-700">Refresh</span>
                    <span
                      className={`absolute top-2 right-2 text-[8px] font-bold uppercase px-1 rounded ${
                        isLive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {isLive ? 'Live' : 'Sim'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenLiveAdvisor();
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors"
                  >
                    <HeadsetIcon className="h-6 w-6 text-gray-500 mb-2" />
                    <span className="text-xs font-bold text-gray-700">Advisor</span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
};

export default Header;
