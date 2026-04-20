

import React, { useState, useEffect, useRef, useContext } from 'react';
import Header from './Header';
import { Page } from '../types';
import QuickActionsSidebar from './QuickActionsSidebar';
import CommandPalette from './CommandPalette';
import LiveAdvisorModal from './LiveAdvisorModal';
import { useTrackPageVisit } from '../context/SelfLearningContext';
import { DataContext } from '../context/DataContext';
import { useFinancialEnginesIntegration } from '../hooks/useFinancialEnginesIntegration';
import CrossEngineAlertsBanner from './CrossEngineAlertsBanner';

interface LayoutProps {
  children: React.ReactNode;
  activePage: Page;
  setActivePage: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
  /** Deep-link into a page (e.g. Notifications → tasks tab) */
  triggerPageActionPair?: (page: Page, action: string) => void;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  activePage,
  setActivePage,
  triggerPageAction,
  triggerPageActionPair,
}) => {
  useTrackPageVisit(activePage);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveAdvisorOpen, setIsLiveAdvisorOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const { data } = useContext(DataContext)!;
  const { ready, analysis, actionQueue } = useFinancialEnginesIntegration();

  const skipToMainContent = () => {
    mainContentRef.current?.focus();
    mainContentRef.current?.scrollIntoView({ block: 'start' });
  };

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
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 w-full"
      >
        <div className="max-w-7xl mx-auto w-full animate-fadeIn min-w-0">
          {data && (
            <CrossEngineAlertsBanner
              ready={ready}
              analysis={analysis ?? undefined}
              actionQueue={actionQueue}
              setActivePage={setActivePage}
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
