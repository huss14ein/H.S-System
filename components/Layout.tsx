

import React, { useState, useEffect, useRef, useContext } from 'react';
import Header from './Header';
import { Page } from '../types';
import QuickActionsSidebar from './QuickActionsSidebar';
import CommandPalette from './CommandPalette';
import LiveAdvisorModal from './LiveAdvisorModal';
import { useTrackPageVisit } from '../context/SelfLearningContext';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import CrossEngineAlertsBanner from './CrossEngineAlertsBanner';
import FinancialDataHydrateBanner from './FinancialDataHydrateBanner';
import CanonicalMetricsExtendedBanner from './shared/CanonicalMetricsExtendedBanner';
import { DataContext } from '../context/DataContext';
import { AuthContext } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketQuoteMeta } from '../hooks/useMarketQuoteMeta';
import { supabase } from '../services/supabaseClient';
import { runAutoNetWorthSnapshotIfDue } from '../services/scheduledNetWorthSnapshot';
import { canAutoCaptureNetWorthSnapshot } from '../services/netWorthSnapshotReadiness';
import { useExtendedCanonicalMetrics } from '../hooks/useCanonicalFinancialMetrics';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { registerQuoteRefreshCancel } from '../utils/navigationBridge';
import { useBackgroundWorkInputPause } from '../hooks/useBackgroundWorkInputPause';
import { PageDeferredDataProvider } from '../context/PageDeferredDataContext';
import DeployFreshnessBanner from './DeployFreshnessBanner';
import DataLoadWarningBanner from './DataLoadWarningBanner';
import { APP_VERSION, getBuildSha } from '../utils/buildInfo';

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
  useBackgroundWorkInputPause();
  const dataCtx = useContext(DataContext);
  const auth = useContext(AuthContext);
  const { exchangeRate } = useCurrency();
  const {
    cancelQuoteRefresh,
    isRefreshing,
    hasQueuedPriceRefresh,
    symbolQuoteUpdatedAt,
    isLive,
  } = useMarketQuoteMeta();

  useEffect(() => {
    registerQuoteRefreshCancel(cancelQuoteRefresh);
    return () => registerQuoteRefreshCancel(null);
  }, [cancelQuoteRefresh]);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveAdvisorOpen, setIsLiveAdvisorOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const { ready, analysis, actionQueue } = useFinancialEnginesIntegration({ eager: false });
  const { headline, extendedReady, simulatedPrices: canonicalSimulatedPrices } = useExtendedCanonicalMetrics();

  const skipToMainContent = () => {
    mainContentRef.current?.focus();
    mainContentRef.current?.scrollIntoView({ block: 'start' });
  };

  useEffect(() => {
    const uid = auth?.user?.id;
    const data = dataCtx?.data;
    if (!uid || !data || !dataCtx.getAvailableCashForAccount) return;

    const snapshotReady = canAutoCaptureNetWorthSnapshot({
      showHydrateBanner: dataCtx.showHydrateBanner,
      isRefreshing,
      hasQueuedPriceRefresh,
      symbolQuoteUpdatedAt,
      isLive,
      data,
      metricsExtendedReady: extendedReady,
      getAvailableCashForAccount: dataCtx.getAvailableCashForAccount,
    });
    if (!snapshotReady) return;

    return scheduleIdleWork(() => {
      void runAutoNetWorthSnapshotIfDue({
        userId: uid,
        data,
        headline,
        exchangeRate,
        getAvailableCashForAccount: dataCtx.getAvailableCashForAccount,
        simulatedPrices: canonicalSimulatedPrices,
        supabase,
        metricsExtendedReady: extendedReady,
        snapshotReadiness: {
          showHydrateBanner: dataCtx.showHydrateBanner,
          isRefreshing,
          hasQueuedPriceRefresh,
          symbolQuoteUpdatedAt,
          isLive,
          metricsExtendedReady: extendedReady,
          getAvailableCashForAccount: dataCtx.getAvailableCashForAccount,
        },
      });
    }, 500);
  }, [
    auth?.user?.id,
    dataCtx?.showHydrateBanner,
    dataCtx?.data,
    dataCtx?.getAvailableCashForAccount,
    exchangeRate,
    canonicalSimulatedPrices,
    headline,
    extendedReady,
    isRefreshing,
    hasQueuedPriceRefresh,
    symbolQuoteUpdatedAt,
    isLive,
  ]);

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
        setActivePage={setActivePage}
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
          <CanonicalMetricsExtendedBanner />
          <DeployFreshnessBanner />
          <DataLoadWarningBanner />
          {ready && (
            <CrossEngineAlertsBanner
              ready={ready}
              analysis={analysis ?? undefined}
              actionQueue={actionQueue}
              setActivePage={setActivePage}
              triggerPageAction={triggerPageAction}
            />
          )}
          <PageDeferredDataProvider>{children}</PageDeferredDataProvider>
          <p className="mt-10 pt-4 border-t border-slate-200/80 text-[10px] text-slate-400 text-center" aria-hidden>
            Finova {APP_VERSION} · build {getBuildSha()}
          </p>
        </div>
      </main>

      <QuickActionsSidebar onAction={triggerPageAction} />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        setActivePage={setActivePage}
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
