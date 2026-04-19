import React, { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import Layout from './Layout';
import { Page } from '../types';
import { DataProvider } from '../context/DataContext';
import { CurrencyProvider } from '../context/CurrencyContext';
import ExchangeRateSync from './ExchangeRateSync';
import { MarketDataProvider } from '../context/MarketDataContext';
import { NotificationsProvider } from '../context/NotificationsContext';
import { TodosProvider } from '../context/TodosContext';
import MarketSimulator from './MarketSimulator';
import { AiProvider } from '../context/AiContext';
import LoadingSpinner from './LoadingSpinner';
import AppErrorBoundary from './AppErrorBoundary';
import { StatementProcessingProvider } from '../context/StatementProcessingContext';
import { AIProvider } from '../context/TransactionAIContext';
import { ReconciliationProvider } from '../context/ReconciliationContext';
import { MultiBankProvider } from '../context/MultiBankContext';
import { PrivacyProvider } from '../context/PrivacyContext';
import { ToastProvider } from '../context/ToastContext';
import { SelfLearningProvider } from '../context/SelfLearningContext';
import { PAGE_DISPLAY_NAMES, INVESTMENT_SUB_NAV_PAGE_NAMES } from '../constants';
/** Eager: avoids a second dynamic chunk fetch (often 404 after deploy when index.html is cached but hashed assets changed). */
import WealthUltraDashboard from '../pages/WealthUltraDashboard';

const Dashboard = lazy(() => import('../pages/Dashboard'));
const Summary = lazy(() => import('../pages/Summary'));
const Accounts = lazy(() => import('../pages/Accounts'));
const Liabilities = lazy(() => import('../pages/Liabilities'));
const Transactions = lazy(() => import('../pages/Transactions'));
const Budgets = lazy(() => import('../pages/Budgets'));
const Goals = lazy(() => import('../pages/Goals'));
const Forecast = lazy(() => import('../pages/Forecast'));
const Analysis = lazy(() => import('../pages/Analysis'));
const Zakat = lazy(() => import('../pages/Zakat'));
const Notifications = lazy(() => import('../pages/Notifications'));
const Settings = lazy(() => import('../pages/Settings'));
const Investments = lazy(() => import('../pages/Investments'));
const Plan = lazy(() => import('../pages/Plan'));
const Assets = lazy(() => import('../pages/Assets'));
const MarketEvents = lazy(() => import('../pages/MarketEvents'));
const SystemHealth = lazy(() => import('../pages/SystemHealth'));
const StatementUpload = lazy(() => import('../pages/StatementUpload'));
const StatementHistoryView = lazy(() => import('../pages/StatementHistoryView'));
const EnginesAndToolsHub = lazy(() => import('../pages/EnginesAndToolsHub'));

const VALID_PAGES: Page[] = [
  'Dashboard', 'Summary', 'Accounts', 'Goals', 'Liabilities', 'Transactions',
  'Budgets', 'Analysis', 'Forecast', 'Zakat', 'Notifications', 'Settings',
  'Investments', 'Plan', 'Wealth Ultra', 'Market Events', 'Recovery Plan',
  'Investment Plan', 'Dividend Tracker', 'AI Rebalancer', 'Watchlist',
  'Assets', 'System & APIs Health', 'Statement Upload', 'Statement History', 'Commodities',
  'Engines & Tools',
];

function decodeHashPage(): string {
  if (typeof window === 'undefined') return '';
  try {
    const hash = window.location.hash.slice(1);
    return hash ? decodeURIComponent(hash) : '';
  } catch (_) {
    return '';
  }
}

function getPageFromHash(): Page | null {
  const decoded = decodeHashPage();
  if (!decoded) return null;
  if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(decoded as Page)) return 'Investments';
  if (VALID_PAGES.includes(decoded as Page)) return decoded as Page;
  return null;
}

function getInitialPageActionFromHash(): string | null {
  const decoded = decodeHashPage();
  if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(decoded as Page)) return `investment-tab:${decoded}`;
  return null;
}

function getInitialPage(): Page {
  const fromHash = getPageFromHash();
  if (fromHash) return fromHash;
  return 'Dashboard';
}

const AuthenticatedAppShell: React.FC = () => {
  const [activePage, setActivePageState] = useState<Page>(getInitialPage);
  const [pageAction, setPageAction] = useState<string | null>(getInitialPageActionFromHash);

  const setActivePage = useCallback((page: Page) => {
    if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(page)) {
      setActivePageState('Investments');
      setPageAction(`investment-tab:${page}`);
      try {
        const hash = '#' + encodeURIComponent('Investments');
        if (window.location.hash !== hash) window.location.hash = hash;
      } catch (_) {}
      return;
    }
    setActivePageState(page);
    setPageAction(null);
    try {
      const hash = '#' + encodeURIComponent(page);
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (_) {}
  }, []);

  useEffect(() => {
    const base = 'Finova';
    const displayName = PAGE_DISPLAY_NAMES[activePage] ?? activePage;
    document.title = activePage === 'Dashboard' ? base : `${base} – ${displayName}`;
    return () => { document.title = base; };
  }, [activePage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      const decoded = decodeHashPage();
      if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(decoded as Page)) {
        setActivePageState('Investments');
        setPageAction(`investment-tab:${decoded}`);
        return;
      }
      setPageAction(null);
      const page = getPageFromHash();
      setActivePageState(page ?? 'Dashboard');
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.replace('#Dashboard');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const triggerPageAction = useCallback((page: Page, action: string) => {
    setActivePageState(page);
    setPageAction(action);
    try {
      const hash = '#' + encodeURIComponent(page);
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (_) {}
  }, []);
  const clearPageAction = () => setPageAction(null);

  const renderPage = () => {
    const actionProps = { pageAction, clearPageAction };
    switch (activePage) {
      case 'Dashboard': return <Dashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Summary': return <Summary setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Accounts': return <Accounts setActivePage={setActivePage} />;
      case 'Liabilities': return <Liabilities setActivePage={setActivePage} />;
      case 'Transactions': return <Transactions {...actionProps} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Budgets': return <Budgets {...actionProps} triggerPageAction={triggerPageAction} setActivePage={setActivePage} />;
      case 'Goals': return <Goals setActivePage={setActivePage} pageAction={pageAction} clearPageAction={clearPageAction} triggerPageAction={triggerPageAction} />;
      case 'Forecast': return <Forecast setActivePage={setActivePage} />;
      case 'Analysis': return <Analysis setActivePage={setActivePage} />;
      case 'Zakat': return <Zakat setActivePage={setActivePage} />;
      case 'Notifications': return <Notifications setActivePage={setActivePage} pageAction={pageAction} clearPageAction={clearPageAction} triggerPageAction={triggerPageAction} />;
      case 'Settings': return <Settings setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Investments': return <Investments {...actionProps} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Plan': return <Plan setActivePage={setActivePage} />;
      case 'Assets': return <Assets {...actionProps} setActivePage={setActivePage} />;
      case 'Commodities': return <Assets {...actionProps} setActivePage={setActivePage} />;
      case 'Statement Upload': return <StatementUpload setActivePage={setActivePage} />;
      case 'Statement History': return <StatementHistoryView setActivePage={setActivePage} />;
      case 'Market Events': return <MarketEvents setActivePage={setActivePage} />;
      case 'System & APIs Health': return <SystemHealth setActivePage={setActivePage} />;
      case 'Wealth Ultra': return <WealthUltraDashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Engines & Tools': return <EnginesAndToolsHub setActivePage={setActivePage} triggerPageAction={triggerPageAction} pageAction={pageAction} clearPageAction={clearPageAction} />;
      default: return <Dashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
    }
  };

  return (
    <ToastProvider>
      <SelfLearningProvider>
        <AiProvider>
          <DataProvider>
            <CurrencyProvider>
              <ExchangeRateSync />
              <MarketDataProvider>
                <TodosProvider>
                  <NotificationsProvider>
                    <StatementProcessingProvider>
                      <AIProvider>
                        <ReconciliationProvider>
                          <MultiBankProvider>
                            <PrivacyProvider>
                              <MarketSimulator />
                              <Layout activePage={activePage} setActivePage={setActivePage} triggerPageAction={triggerPageAction} triggerPageActionPair={triggerPageAction}>
                                <AppErrorBoundary pageLabel={activePage} onRecover={() => setActivePage('Dashboard')}>
                                  <Suspense fallback={<LoadingSpinner className="min-h-[24rem]" />}>
                                    {renderPage()}
                                  </Suspense>
                                </AppErrorBoundary>
                              </Layout>
                            </PrivacyProvider>
                          </MultiBankProvider>
                        </ReconciliationProvider>
                      </AIProvider>
                    </StatementProcessingProvider>
                  </NotificationsProvider>
                </TodosProvider>
              </MarketDataProvider>
            </CurrencyProvider>
          </DataProvider>
        </AiProvider>
      </SelfLearningProvider>
    </ToastProvider>
  );
};

export default AuthenticatedAppShell;
