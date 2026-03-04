

import React, { useState, useEffect } from 'react';
import Header from './Header';
import { Page } from '../types';
import QuickActionsSidebar from './QuickActionsSidebar';
import CommandPalette from './CommandPalette';
import LiveAdvisorModal from './LiveAdvisorModal';

interface LayoutProps {
  children: React.ReactNode;
  activePage: Page;
  setActivePage: (page: Page) => void;
  triggerPageAction: (page: Page, action: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activePage, setActivePage, triggerPageAction }) => {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveAdvisorOpen, setIsLiveAdvisorOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);


  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 flex flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 bg-white border border-slate-300 px-3 py-2 rounded-lg text-sm">Skip to main content</a>
      <Header activePage={activePage} setActivePage={setActivePage} onOpenLiveAdvisor={() => setIsLiveAdvisorOpen(true)} onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
      
      <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 w-full">
        <div className="max-w-7xl mx-auto w-full animate-slideInUp min-w-0">
            {children}
        </div>
      </main>
      
      <QuickActionsSidebar onAction={triggerPageAction} />
      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        setActivePage={setActivePage}
        onOpenLiveAdvisor={() => { setIsCommandPaletteOpen(false); setIsLiveAdvisorOpen(true); }}
      />
       <LiveAdvisorModal 
        isOpen={isLiveAdvisorOpen}
        onClose={() => setIsLiveAdvisorOpen(false)}
      />
    </div>
  );
};

export default Layout;
