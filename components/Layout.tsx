

import React, { useState, useEffect, useRef, useContext, useCallback, startTransition } from 'react';
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
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { useDebouncedMarketPrices } from '../hooks/useDebouncedMarketPrices';
import { supabase } from '../services/supabaseClient';
import { runAutoNetWorthSnapshotIfDue } from '../services/scheduledNetWorthSnapshot';
import { pauseBackgroundWork } from '../utils/backgroundWorkGate';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { PageDeferredDataProvider } from '../context/PageDeferredDataContext';

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
  const debouncedPrices = useDebouncedMarketPrices();
  const { cancelQuoteRefresh } = useMarketQuoteMeta();
  const navigatePage = useCallback(
    (page: Page) => {
      // Pause background quote/metrics work so route paint and input stay responsive.
      pauseBackgroundWork();
      cancelQuoteRefresh();
      startTransition(() => {
        setActivePage(page);
      });
    },
    [setActivePage, cancelQuoteRefresh],
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveAdvisorOpen, setIsLiveAdvisorOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const { ready, analysis, actionQueue } = useFinancialEnginesIntegration({ eager: false });

  const skipToMainContent = () => {
    mainContentRef.current?.focus();
    mainContentRef.current?.scrollIntoView({ block: 'start' });
  };

  useEffect(() => {
    const uid = auth?.user?.id;
    const data = dataCtx?.data;
    if (!uid || !data || dataCtx?.showHydrateBanner || !dataCtx.getAvailableCashForAccount) return;
    return scheduleIdleWork(() => {
      void runAutoNetWorthSnapshotIfDue({
        userId: uid,
        data,
        exchangeRate,
        getAvailableCashForAccount: dataCtx.getAvailableCashForAccount,
        simulatedPrices: debouncedPrices,
        supabase,
      });
    }, 4000);
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
          <PageDeferredDataProvider>{children}</PageDeferredDataProvider>
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
