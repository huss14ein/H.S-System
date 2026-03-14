import React, { useState, useContext, useCallback, Suspense, lazy, startTransition } from 'react';
import Layout from './components/Layout';
import { Page } from './types';
import LoginPage from './pages/LoginPage';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { MarketDataProvider } from './context/MarketDataContext';
import { NotificationsProvider } from './context/NotificationsContext';
import MarketSimulator from './components/MarketSimulator';
import { AiProvider } from './context/AiContext';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';

import { StatementProcessingProvider } from './context/StatementProcessingContext';
import { AIProvider } from './context/TransactionAIContext';
import { ReconciliationProvider } from './context/ReconciliationContext';
import { MultiBankProvider } from './context/MultiBankContext';

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

const VALID_PAGES: Page[] = ['Dashboard', 'Summary', 'Accounts', 'Goals', 'Liabilities', 'Transactions', 'Budgets', 'Analysis', 'Forecast', 'Zakat', 'Notifications', 'Settings'];

function getPageFromHash(): Page | null {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash.slice(1);
    const decoded = hash ? decodeURIComponent(hash) : '';
    if (decoded && VALID_PAGES.includes(decoded as Page)) return decoded as Page;
  } catch (_) {}
  return null;
}

function getInitialPage(): Page {
  const fromHash = getPageFromHash();
  if (fromHash) return fromHash;
  return 'Dashboard';
}

const App: React.FC = () => {
  const [activePage, setActivePageState] = useState<Page>(getInitialPage);
  const setActivePage = useCallback((page: Page) => {
    startTransition(() => {
      setActivePageState(page);
    });
    try {
      const hash = '#' + encodeURIComponent(page);
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (_) {}
  }, []);

  // Sync state from URL when user uses browser back/forward
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      const page = getPageFromHash();
      startTransition(() => {
        setActivePageState(page ?? 'Dashboard');
      });
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.replace('#Dashboard');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  React.useEffect(() => {
    const onUnhandled = () => {
      // Keep app resilient after browser wake/sleep transitions and stale async callbacks.
      setActivePageState((prev) => prev ?? 'Dashboard');
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);
  const [pageAction, setPageAction] = useState<string | null>(null);
  const auth = useContext(AuthContext);

  if (!auth) {
    return null; // Or a loading spinner
  }

  const { isAuthenticated } = auth;

  const triggerPageAction = (page: Page, action: string) => {
    setActivePage(page);
    setPageAction(action);
  };
  const clearPageAction = () => setPageAction(null);

  const renderPage = () => {
    const actionProps = { pageAction, clearPageAction };
    switch (activePage) {
      case 'Dashboard': return <Dashboard setActivePage={setActivePage} />;
      case 'Summary': return <Summary setActivePage={setActivePage} />;
      case 'Accounts': return <Accounts setActivePage={setActivePage} />;
      case 'Liabilities': return <Liabilities setActivePage={setActivePage} />;
      case 'Transactions': return <Transactions {...actionProps} triggerPageAction={triggerPageAction} />;
      case 'Budgets': return <Budgets triggerPageAction={triggerPageAction} />;
      case 'Goals': return <Goals setActivePage={setActivePage} />;
      case 'Forecast': return <Forecast />;
      case 'Analysis': return <Analysis />;
      case 'Zakat': return <Zakat />;
      case 'Notifications': return <Notifications setActivePage={setActivePage} />;
      case 'Settings': return <Settings setActivePage={setActivePage} />;
      default: return <Dashboard setActivePage={setActivePage} />;
    }
  };
  
  if (!isAuthenticated) {
    return (
      <ThemeProvider>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <AiProvider>
          <DataProvider>
            <CurrencyProvider>
              <MarketDataProvider>
                <NotificationsProvider>
                  <StatementProcessingProvider>
                    <AIProvider>
                      <ReconciliationProvider>
                        <MultiBankProvider>
                          <MarketSimulator />
                          <Layout activePage={activePage} setActivePage={setActivePage} triggerPageAction={triggerPageAction}>
                          <AppErrorBoundary pageLabel={activePage} onRecover={() => setActivePage('Dashboard')}>
                            <Suspense fallback={<LoadingSpinner className="min-h-[24rem]" />}>
                              {renderPage()}
                            </Suspense>
                          </AppErrorBoundary>
                          </Layout>
                        </MultiBankProvider>
                      </ReconciliationProvider>
                    </AIProvider>
                  </StatementProcessingProvider>
                </NotificationsProvider>
              </MarketDataProvider>
            </CurrencyProvider>
          </DataProvider>
        </AiProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
