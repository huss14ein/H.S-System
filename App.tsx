import React, { useState, useContext, useCallback, useEffect, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import { Page } from './types';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PendingApprovalPage from './pages/PendingApprovalPage';
import { AuthContext } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import { CurrencyProvider } from './context/CurrencyContext';
import ExchangeRateSync from './components/ExchangeRateSync';
import { MarketDataProvider } from './context/MarketDataContext';
import { NotificationsProvider } from './context/NotificationsContext';
import { TodosProvider } from './context/TodosContext';
import MarketSimulator from './components/MarketSimulator';
import { AiProvider } from './context/AiContext';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';

import { StatementProcessingProvider } from './context/StatementProcessingContext';
import { AIProvider } from './context/TransactionAIContext';
import { ReconciliationProvider } from './context/ReconciliationContext';
import { MultiBankProvider } from './context/MultiBankContext';
import { PrivacyProvider } from './context/PrivacyContext';
import { ToastProvider } from './context/ToastContext';
import { SelfLearningProvider } from './context/SelfLearningContext';
import { PAGE_DISPLAY_NAMES, INVESTMENT_SUB_NAV_PAGE_NAMES } from './constants';

// --- Lazy Load Pages for Code Splitting ---
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Summary = lazy(() => import('./pages/Summary'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Liabilities = lazy(() => import('./pages/Liabilities'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Goals = lazy(() => import('./pages/Goals'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Zakat = lazy(() => import('./pages/Zakat'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));

// Investment & Strategy Pages
const Investments = lazy(() => import('./pages/Investments'));

// Financial Planning Pages
const Plan = lazy(() => import('./pages/Plan'));

// Asset Management Pages
const Assets = lazy(() => import('./pages/Assets'));

// System & Market Pages
const MarketEvents = lazy(() => import('./pages/MarketEvents'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));

// Statement & Data Import
const StatementUpload = lazy(() => import('./pages/StatementUpload'));
const StatementHistoryView = lazy(() => import('./pages/StatementHistoryView'));

// Wealth Ultra (allocation engine)
const WealthUltraDashboard = lazy(() => import('./pages/WealthUltraDashboard'));
const EnginesAndToolsHub = lazy(() => import('./pages/EnginesAndToolsHub'));

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

const App: React.FC = () => {
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

  // Update document title for browser tab / bookmarks
  useEffect(() => {
    const base = 'Finova';
    const displayName = PAGE_DISPLAY_NAMES[activePage] ?? activePage;
    document.title = activePage === 'Dashboard' ? base : `${base} – ${displayName}`;
    return () => { document.title = base; };
  }, [activePage]);

  // Sync state from URL when user uses browser back/forward
  React.useEffect(() => {
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
  const auth = useContext(AuthContext);

  if (!auth) {
    return null; // Or a loading spinner
  }

  const { isAuthenticated, isApproved } = auth;

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
      case 'Budgets': return <Budgets triggerPageAction={triggerPageAction} setActivePage={setActivePage} />;
      case 'Goals': return <Goals setActivePage={setActivePage} />;
      case 'Forecast': return <Forecast setActivePage={setActivePage} />;
      case 'Analysis': return <Analysis setActivePage={setActivePage} />;
      case 'Zakat': return <Zakat setActivePage={setActivePage} />;
      case 'Notifications': return <Notifications setActivePage={setActivePage} pageAction={pageAction} clearPageAction={clearPageAction} triggerPageAction={triggerPageAction} />;
      case 'Settings': return <Settings setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      
      // Investment & Strategy Pages (sub-views live inside Investments only)
      case 'Investments': return <Investments {...actionProps} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      
      // Financial Planning Pages
      case 'Plan': return <Plan setActivePage={setActivePage} />;
      
      // Asset Management Pages (commodities live inside Assets only; Commodities redirects to Assets)
      case 'Assets': return <Assets {...actionProps} setActivePage={setActivePage} />;
      case 'Commodities': return <Assets {...actionProps} setActivePage={setActivePage} />;

      // Statement Import & History
      case 'Statement Upload': return <StatementUpload setActivePage={setActivePage} />;
      case 'Statement History': return <StatementHistoryView setActivePage={setActivePage} />;
      
      // System & Market Pages
      case 'Market Events': return <MarketEvents setActivePage={setActivePage} />;
      case 'System & APIs Health': return <SystemHealth setActivePage={setActivePage} />;
      case 'Wealth Ultra': return <WealthUltraDashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Engines & Tools': return <EnginesAndToolsHub setActivePage={setActivePage} triggerPageAction={triggerPageAction} pageAction={pageAction} clearPageAction={clearPageAction} />;
      
      default: return <Dashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
    }
  };
  
  const [authHash, setAuthHash] = useState(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setAuthHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!isAuthenticated) {
    const showSignup = authHash === '#signup';
    return (
      <ThemeProvider>
        {showSignup ? <SignupPage /> : <LoginPage />}
      </ThemeProvider>
    );
  }

  if (isApproved === false) {
    return (
      <ThemeProvider>
        <PendingApprovalPage />
      </ThemeProvider>
    );
  }

  if (isApproved === null) {
    return (
      <ThemeProvider>
        <div className="flex justify-center items-center min-h-screen bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Checking access" />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
};

export default App;
