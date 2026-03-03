import React, { useState, useContext, useCallback, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import { Page } from './types';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import { AuthContext } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { MarketDataProvider } from './context/MarketDataContext';
import { NotificationsProvider } from './context/NotificationsContext';
import MarketSimulator from './components/MarketSimulator';
import { AiProvider } from './context/AiContext';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';

// --- Lazy Load Pages for Code Splitting ---
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Summary = lazy(() => import('./pages/Summary'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Investments = lazy(() => import('./pages/Investments'));
const Assets = lazy(() => import('./pages/Assets'));
const Liabilities = lazy(() => import('./pages/Liabilities'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Goals = lazy(() => import('./pages/Goals'));
const Plan = lazy(() => import('./pages/Plan'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Zakat = lazy(() => import('./pages/Zakat'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));
const WealthUltraDashboard = lazy(() => import('./pages/WealthUltraDashboard'));

const VALID_PAGES: Page[] = ['Dashboard', 'Summary', 'Accounts', 'Goals', 'Investments', 'Assets', 'Liabilities', 'Transactions', 'Budgets', 'Plan', 'Analysis', 'Forecast', 'Zakat', 'Notifications', 'System & APIs Health', 'Settings', 'Wealth Ultra'];

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
    setActivePageState(page);
    try {
      const hash = '#' + encodeURIComponent(page);
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (_) {}
  }, []);

  // Sync state from URL when user uses browser back/forward
  React.useEffect(() => {
    const onHashChange = () => {
      const page = getPageFromHash();
      setActivePageState(page ?? 'Dashboard');
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
  const [isLoginView, setIsLoginView] = useState(true);
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
      case 'Summary': return <Summary />;
      case 'Accounts': return <Accounts setActivePage={setActivePage} />;
      case 'Investments': return <Investments {...actionProps} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Assets': return <Assets {...actionProps} />;
      case 'Liabilities': return <Liabilities setActivePage={setActivePage} />;
      case 'Transactions': return <Transactions {...actionProps} triggerPageAction={triggerPageAction} />;
      case 'Budgets': return <Budgets />;
      case 'Goals': return <Goals setActivePage={setActivePage} />;
      case 'Plan': return <Plan setActivePage={setActivePage} />;
      case 'Forecast': return <Forecast />;
      case 'Analysis': return <Analysis />;
      case 'Zakat': return <Zakat />;
      case 'Notifications': return <Notifications setActivePage={setActivePage} />;
      case 'Settings': return <Settings setActivePage={setActivePage} />;
      case 'System & APIs Health': return <SystemHealth />;
      case 'Wealth Ultra': return <WealthUltraDashboard setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      default: return <Dashboard setActivePage={setActivePage} />;
    }
  };
  
  if (!isAuthenticated) {
    return isLoginView ? <LoginPage onSwitchToSignup={() => setIsLoginView(false)} /> : <SignupPage onSwitchToLogin={() => setIsLoginView(true)} />;
  }

  return (
    <AiProvider>
      <DataProvider>
        <CurrencyProvider>
          <MarketDataProvider>
            <NotificationsProvider>
              <MarketSimulator />
              <Layout activePage={activePage} setActivePage={setActivePage} triggerPageAction={triggerPageAction}>
              <AppErrorBoundary pageLabel={activePage} onRecover={() => setActivePage('Dashboard')}>
                <Suspense fallback={<LoadingSpinner className="min-h-[24rem]" />}>
                  {renderPage()}
                </Suspense>
              </AppErrorBoundary>
              </Layout>
            </NotificationsProvider>
          </MarketDataProvider>
        </CurrencyProvider>
      </DataProvider>
    </AiProvider>
  );
};

export default App;
