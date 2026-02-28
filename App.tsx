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

const LoadingSpinner: React.FC = () => (
    <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
    </div>
);


const VALID_PAGES: Page[] = ['Dashboard', 'Summary', 'Accounts', 'Goals', 'Investments', 'Assets', 'Liabilities', 'Transactions', 'Budgets', 'Plan', 'Analysis', 'Forecast', 'Zakat', 'Notifications', 'System & APIs Health', 'Settings', 'Wealth Ultra'];
const LAST_PAGE_KEY = 'h.s.last-page';

function getInitialPage(): Page {
  if (typeof window === 'undefined') return 'Dashboard';
  try {
    const saved = localStorage.getItem(LAST_PAGE_KEY);
    if (saved && VALID_PAGES.includes(saved as Page)) return saved as Page;
  } catch (_) {}
  return 'Dashboard';
}

const App: React.FC = () => {
  const [activePage, setActivePageState] = useState<Page>(getInitialPage);
  const setActivePage = useCallback((page: Page) => {
    setActivePageState(page);
    try { localStorage.setItem(LAST_PAGE_KEY, page); } catch (_) {}
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
      case 'Liabilities': return <Liabilities />;
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
              <Suspense fallback={<LoadingSpinner />}>
                {renderPage()}
              </Suspense>
              </Layout>
            </NotificationsProvider>
          </MarketDataProvider>
        </CurrencyProvider>
      </DataProvider>
    </AiProvider>
  );
};

export default App;