

import React, { useState, useEffect } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
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
    <div className="min-h-screen bg-slate-50 text-gray-800 flex">
      {/* Sidebar for Desktop */}
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header activePage={activePage} setActivePage={setActivePage} onOpenLiveAdvisor={() => setIsLiveAdvisorOpen(true)} />
        
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto animate-fadeIn">
              {children}
          </div>
        </main>
      </div>
      
      <QuickActionsSidebar onAction={triggerPageAction} />
      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        setActivePage={setActivePage}
      />
       <LiveAdvisorModal 
        isOpen={isLiveAdvisorOpen}
        onClose={() => setIsLiveAdvisorOpen(false)}
      />
       <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default Layout;