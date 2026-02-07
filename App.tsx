import React, { useState, useContext, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import { Page } from './types';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import { AuthContext } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { MarketDataProvider } from './context/MarketDataContext';
import MarketSimulator from './components/MarketSimulator';

// --- Lazy Load Pages for Code Splitting ---
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Summary = lazy(() => import('./pages/Summary'));
const Platforms = lazy(() => import('./pages/Platforms'));
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
const SystemHealth = lazy(() => import('./pages/SystemHealth'));

const LoadingSpinner: React.FC = () => (
    <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
    </div>
);


const App: React.FC = () => {
  const [activePage, setActivePage] = useState<Page>('Dashboard');
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
      case 'Platform': return <Platforms setActivePage={setActivePage} />;
      case 'Investments': return <Investments {...actionProps} />;
      case 'Assets': return <Assets {...actionProps} />;
      case 'Liabilities': return <Liabilities />;
      case 'Transactions': return <Transactions {...actionProps} />;
      case 'Budgets': return <Budgets />;
      case 'Goals': return <Goals />;
      case 'Plan': return <Plan />;
      case 'Forecast': return <Forecast />;
      case 'Analysis': return <Analysis />;
      case 'Zakat': return <Zakat />;
      case 'System & APIs Health': return <SystemHealth />;
      default: return <Dashboard setActivePage={setActivePage} />;
    }
  };
  
  if (!isAuthenticated) {
    return isLoginView ? <LoginPage onSwitchToSignup={() => setIsLoginView(false)} /> : <SignupPage onSwitchToLogin={() => setIsLoginView(true)} />;
  }

  return (
    <DataProvider>
      <CurrencyProvider>
        <MarketDataProvider>
          <MarketSimulator />
          <Layout activePage={activePage} setActivePage={setActivePage} triggerPageAction={triggerPageAction}>
            <Suspense fallback={<LoadingSpinner />}>
              {renderPage()}
            </Suspense>
          </Layout>
        </MarketDataProvider>
      </CurrencyProvider>
    </DataProvider>
  );
};

export default App;