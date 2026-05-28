import React, { useState, useCallback, useEffect } from 'react';
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
import AppErrorBoundary from './AppErrorBoundary';
import PageRouteSuspense from './PageRouteSuspense';
import { StatementProcessingProvider } from '../context/StatementProcessingContext';
import { AIProvider } from '../context/TransactionAIContext';
import { ReconciliationProvider } from '../context/ReconciliationContext';
import { MultiBankProvider } from '../context/MultiBankContext';
import { PrivacyProvider } from '../context/PrivacyContext';
import { ToastProvider } from '../context/ToastContext';
import { ConfirmActionProvider } from '../hooks/useConfirmAction';
import { SelfLearningProvider } from '../context/SelfLearningContext';
import { PAGE_DISPLAY_NAMES, INVESTMENT_SUB_NAV_PAGE_NAMES } from '../constants';
import { PAGE_MODULES, prefetchCommonPagesIdle, prefetchPage, resolveShellPage } from '../utils/lazyPages';
import { CanonicalFinancialMetricsProvider } from '../context/CanonicalFinancialMetricsContext';
import { LanguageProvider } from '../context/LanguageContext';

const VALID_PAGES: Page[] = [
  'Dashboard', 'Summary', 'Accounts', 'Goals', 'Liabilities', 'Transactions',
  'Budgets', 'Analysis', 'Forecast', 'Zakat', 'Notifications', 'Settings',
  'Investments', 'Plan', 'Wealth Ultra', 'Market Events', 'Recovery Plan',
  'Investment Plan', 'Dividend Tracker', 'AI Rebalancer', 'Watchlist',
  'Assets', 'System & APIs Health', 'Statement Upload', 'Statement History', 'Commodities',
  'Engines & Tools', 'Installments',
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

/** Hash anchors that denote a section on System Health (not standalone page names). */
function isSystemHealthSectionHash(decoded: string): boolean {
  return decoded === 'data-reconciliation' || decoded === 'investment-kpi-reconciliation' || decoded === 'developer';
}

function getPageFromHash(): Page | null {
  const decoded = decodeHashPage();
  if (!decoded) return null;
  if (isSystemHealthSectionHash(decoded)) return 'System & APIs Health';
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

function investmentTabAction(page: Page): string | null {
  return INVESTMENT_SUB_NAV_PAGE_NAMES.includes(page) ? `investment-tab:${page}` : null;
}

type AppRouteHostProps = {
  activePage: Page;
  pageAction: string | null;
  setActivePage: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
  clearPageAction: () => void;
};

const AppRouteHost: React.FC<AppRouteHostProps> = ({
  activePage,
  pageAction,
  setActivePage,
  triggerPageAction,
  clearPageAction,
}) => {
  const renderPage = () => {
    const shell = resolveShellPage(activePage);
    const Lazy = PAGE_MODULES[shell]?.Lazy ?? PAGE_MODULES.Dashboard!.Lazy;
    const routeKey = `${shell}:${pageAction ?? ''}`;
    const tabAction = investmentTabAction(activePage);
    const effectivePageAction = tabAction ?? pageAction;
    const actionProps = { pageAction: effectivePageAction, clearPageAction };
    const nav = { setActivePage, triggerPageAction };

    switch (shell) {
      case 'Dashboard':
        return <Lazy key={routeKey} {...nav} {...actionProps} />;
      case 'Summary':
        return <Lazy key={routeKey} {...nav} />;
      case 'Accounts':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Liabilities':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Transactions':
        return <Lazy key={routeKey} {...actionProps} {...nav} />;
      case 'Budgets':
        return <Lazy key={routeKey} {...actionProps} triggerPageAction={triggerPageAction} setActivePage={setActivePage} />;
      case 'Goals':
        return <Lazy key={routeKey} setActivePage={setActivePage} pageAction={pageAction} clearPageAction={clearPageAction} triggerPageAction={triggerPageAction} />;
      case 'Forecast':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Analysis':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Zakat':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Notifications':
        return <Lazy key={routeKey} setActivePage={setActivePage} {...actionProps} triggerPageAction={triggerPageAction} />;
      case 'Settings':
        return <Lazy key={routeKey} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Investments':
        return <Lazy key={routeKey} {...actionProps} {...nav} />;
      case 'Plan':
        return <Lazy key={routeKey} {...nav} />;
      case 'Assets':
        return <Lazy key={routeKey} {...actionProps} setActivePage={setActivePage} />;
      case 'Commodities':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Statement Upload':
        return <Lazy key={routeKey} setActivePage={setActivePage} triggerPageAction={triggerPageAction} />;
      case 'Statement History':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Market Events':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'System & APIs Health':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      case 'Wealth Ultra':
        return <Lazy key={routeKey} {...nav} />;
      case 'Engines & Tools':
        return <Lazy key={routeKey} {...nav} {...actionProps} />;
      case 'Installments':
        return <Lazy key={routeKey} setActivePage={setActivePage} />;
      default:
        return <Lazy key={routeKey} {...nav} />;
    }
  };

  return (
    <AppErrorBoundary pageLabel={activePage} onRecover={() => setActivePage('Dashboard')}>
      <PageRouteSuspense activePage={activePage}>{renderPage()}</PageRouteSuspense>
    </AppErrorBoundary>
  );
};

const AuthenticatedAppShell: React.FC = () => {
  const [activePage, setActivePageState] = useState<Page>(getInitialPage);
  const [pageAction, setPageAction] = useState<string | null>(getInitialPageActionFromHash);

  const setActivePage = useCallback((page: Page) => {
    prefetchPage(page);
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
    prefetchPage(getInitialPage());
    prefetchCommonPagesIdle();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      const decoded = decodeHashPage();
      if (INVESTMENT_SUB_NAV_PAGE_NAMES.includes(decoded as Page)) {
        prefetchPage(decoded as Page);
        setActivePageState('Investments');
        setPageAction(`investment-tab:${decoded}`);
        return;
      }
      setPageAction(null);
      const page = getPageFromHash();
      if (page) prefetchPage(page);
      setActivePageState(page ?? 'Dashboard');
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.replace('#Dashboard');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const triggerPageAction = useCallback((page: Page, action: string) => {
    prefetchPage(page);
    setActivePageState(resolveShellPage(page));
    setPageAction(action);
    try {
      const hash = '#' + encodeURIComponent(resolveShellPage(page));
      if (window.location.hash !== hash) window.location.hash = hash;
    } catch (_) {}
  }, []);
  const clearPageAction = () => setPageAction(null);

  return (
    <ToastProvider>
      <ConfirmActionProvider>
      <SelfLearningProvider>
        <AiProvider>
          <LanguageProvider>
            <DataProvider>
              <CurrencyProvider>
                <ExchangeRateSync />
                <MarketDataProvider>
                  <CanonicalFinancialMetricsProvider>
                  <TodosProvider>
                    <NotificationsProvider>
                      <StatementProcessingProvider>
                        <AIProvider>
                          <ReconciliationProvider>
                            <MultiBankProvider>
                              <PrivacyProvider>
                                <MarketSimulator />
                                <Layout
                                  activePage={activePage}
                                  setActivePage={setActivePage}
                                  triggerPageAction={triggerPageAction}
                                  triggerPageActionPair={triggerPageAction}
                                  contentMaxClass={
                                    activePage === 'Dashboard' || activePage === 'Summary' ? 'max-w-screen-2xl' : 'max-w-7xl'
                                  }
                                >
                                  <AppRouteHost
                                    activePage={activePage}
                                    pageAction={pageAction}
                                    setActivePage={setActivePage}
                                    triggerPageAction={triggerPageAction}
                                    clearPageAction={clearPageAction}
                                  />
                                </Layout>
                              </PrivacyProvider>
                            </MultiBankProvider>
                          </ReconciliationProvider>
                        </AIProvider>
                      </StatementProcessingProvider>
                    </NotificationsProvider>
                  </TodosProvider>
                  </CanonicalFinancialMetricsProvider>
                </MarketDataProvider>
              </CurrencyProvider>
            </DataProvider>
          </LanguageProvider>
        </AiProvider>
      </SelfLearningProvider>
      </ConfirmActionProvider>
    </ToastProvider>
  );
};

export default AuthenticatedAppShell;
