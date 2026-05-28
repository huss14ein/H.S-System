

import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { INVESTMENT_SUB_NAV_PAGE_NAMES } from '../constants';
import Header from './Header';
import { Page } from '../types';
import QuickActionsSidebar from './QuickActionsSidebar';
import CommandPalette from './CommandPalette';
import LiveAdvisorModal from './LiveAdvisorModal';
import { useTrackPageVisit } from '../context/SelfLearningContext';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import CrossEngineAlertsBanner from './CrossEngineAlertsBanner';
import FinancialDataHydrateBanner from './FinancialDataHydrateBanner';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketData } from '../context/MarketDataContext';
import { useDebouncedMarketPrices } from '../hooks/useDebouncedMarketPrices';
import { supabase } from '../services/supabaseClient';
import { runAutoNetWorthSnapshotIfDue } from '../services/scheduledNetWorthSnapshot';

interface LayoutProps {
  children: React.ReactNode;
  activePage: Page;
  setActivePage: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
  /** Deep-link into a page (e.g. Notifications → tasks tab) */
  triggerPageActionPair?: (page: Page, action: string) => void;
  /** Main column max width (Tailwind classes). Wider on data-heavy pages (Dashboard / Summary). */
  contentMaxClass?: string;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  activePage,
  setActivePage,
  triggerPageAction,
  triggerPageActionPair,
  contentMaxClass = 'max-w-7xl',
}) => {
  useTrackPageVisit(activePage);
  const dataCtx = useContext(DataContext);
  const auth = useContext(AuthContext);
  const { exchangeRate } = useCurrency();
  const debouncedPrices = useDebouncedMarketPrices(1500);
  const { cancelQuoteRefresh } = useMarketData();
  const navigatePage = useCallback(
    (page: Page) => {
      const fromQuoteHeavy =
        activePage === 'Dashboard' ||
        activePage === 'Summary' ||
        activePage === 'Investments' ||
        INVESTMENT_SUB_NAV_PAGE_NAMES.includes(activePage);
      const toQuoteHeavy =
        page === 'Dashboard' ||
        page === 'Summary' ||
        page === 'Investments' ||
        INVESTMENT_SUB_NAV_PAGE_NAMES.includes(page);
      // Prevent quote refresh work from starving navigation/UI thread.
      if (fromQuoteHeavy && !toQuoteHeavy) cancelQuoteRefresh();
      setActivePage(page);
    },
    [activePage, setActivePage, cancelQuoteRefresh],
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveAdvisorOpen, setIsLiveAdvisorOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const { ready, analysis, actionQueue } = useFinancialEnginesIntegration();

  const skipToMainContent = () => {
    mainContentRef.current?.focus();
    mainContentRef.current?.scrollIntoView({ block: 'start' });
  };

  useEffect(() => {
    const uid = auth?.user?.id;
    const data = dataCtx?.data;
    if (!uid || !data || dataCtx?.showHydrateBanner || !dataCtx.getAvailableCashForAccount) return;
    void runAutoNetWorthSnapshotIfDue({
      userId: uid,
      data,
      exchangeRate,
      getAvailableCashForAccount: dataCtx.getAvailableCashForAccount,
      simulatedPrices: debouncedPrices,
      supabase,
    });
  }, [auth?.user?.id, dataCtx?.showHydrateBanner, dataCtx?.data, exchangeRate, debouncedPrices, dataCtx?.getAvailableCashForAccount]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/60 text-gray-800 flex flex-col">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          skipToMainContent();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 bg-white border border-slate-300 px-3 py-2 rounded-lg text-sm"
      >
        Skip to main content
      </a>
      <Header
        activePage={activePage}
        setActivePage={navigatePage}
        onOpenLiveAdvisor={() => setIsLiveAdvisorOpen(true)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        triggerPageActionPair={triggerPageActionPair}
      />

      <main
        ref={mainContentRef}
        id="main-content"
        tabIndex={-1}
        aria-label="Main content"
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 lg:p-8 w-full"
      >
        <div className={`${contentMaxClass} mx-auto w-full animate-fadeIn min-w-0`}>
          <FinancialDataHydrateBanner />
          {ready && (
            <CrossEngineAlertsBanner
              ready={ready}
              analysis={analysis ?? undefined}
              actionQueue={actionQueue}
              setActivePage={navigatePage}
              triggerPageAction={triggerPageAction}
            />
          )}
          {children}
        </div>
      </main>

      <QuickActionsSidebar onAction={triggerPageAction} />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        setActivePage={navigatePage}
        triggerPageAction={triggerPageAction}
        onOpenLiveAdvisor={() => {
          setIsCommandPaletteOpen(false);
          setIsLiveAdvisorOpen(true);
        }}
      />

      <LiveAdvisorModal
        isOpen={isLiveAdvisorOpen}
        onClose={() => setIsLiveAdvisorOpen(false)}
      />
    </div>
  );
};

export default Layout;
