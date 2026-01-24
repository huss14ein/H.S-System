import React, { useState, useContext } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import { Page } from './types';
import Investments from './pages/Investments';
import Goals from './pages/Goals';
import Assets from './pages/Assets';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import { AuthContext } from './context/AuthContext';
import Zakat from './pages/Zakat';
import Plan from './pages/Plan';
import Liabilities from './pages/Liabilities';
import Analysis from './pages/Analysis';
import SystemHealth from './pages/SystemHealth';
import { DataProvider } from './context/DataContext';
import Summary from './pages/Summary';
import TransactionsPage from './pages/TransactionsPage';
import Forecast from './pages/Forecast';
import Budgets from './pages/Budgets';
import { CurrencyProvider } from './context/CurrencyContext';


const App: React.FC = () => {
  const [activePage, setActivePage] = useState<Page>('Dashboard');
  const [isLoginView, setIsLoginView] = useState(true);
  const auth = useContext(AuthContext);

  if (!auth) {
    return null; // Or a loading spinner
  }

  const { isAuthenticated } = auth;

  const renderPage = () => {
    switch (activePage) {
      case 'Dashboard':
        return <Dashboard setActivePage={setActivePage} />;
      case 'Summary':
        return <Summary />;
      case 'Investments':
        return <Investments />;
      case 'Assets':
        return <Assets />;
      case 'Liabilities':
        return <Liabilities />;
      case 'Transactions':
        return <TransactionsPage />;
      case 'Budgets':
        return <Budgets />;
      case 'Goals':
        return <Goals />;
      case 'Plan':
        return <Plan />;
      case 'Forecast':
        return <Forecast />;
      case 'Analysis':
        return <Analysis />;
      case 'Zakat':
        return <Zakat />;
      case 'System & APIs Health':
        return <SystemHealth />;
      default:
        return <Dashboard setActivePage={setActivePage} />;
    }
  };
  
  if (!isAuthenticated) {
    return isLoginView ? <LoginPage onSwitchToSignup={() => setIsLoginView(false)} /> : <SignupPage onSwitchToLogin={() => setIsLoginView(true)} />;
  }

  return (
    <DataProvider>
      <CurrencyProvider>
        <Layout activePage={activePage} setActivePage={setActivePage}>
          {renderPage()}
        </Layout>
      </CurrencyProvider>
    </DataProvider>
  );
};

export default App;