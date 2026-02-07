

import React, { useState, useEffect } from 'react';
import Header from './Header';
import { Page } from '../types';
import QuickActionsSidebar from './QuickActionsSidebar';
import CommandPalette from './CommandPalette';
import LiveAdvisorModal from './LiveAdvisorModal';
import { HeadsetIcon } from './icons/HeadsetIcon';

interface LayoutProps {
  children: React.ReactNode;
  activePage: Page;
  setActivePage: (page: Page) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activePage, setActivePage }) => {
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
      <Header activePage={activePage} setActivePage={setActivePage} />
      <main className="p-4 sm:p-6 lg:p-8 flex-grow">
        <div className="animate-fadeIn">
            {children}
        </div>
      </main>
      
      <QuickActionsSidebar setActivePage={setActivePage} />
      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
        setActivePage={setActivePage}
      />
      <div className="fixed bottom-24 right-6 z-20">
         <button
            onClick={() => setIsLiveAdvisorOpen(true)}
            className="group relative flex items-center justify-center w-16 h-16 bg-secondary text-white rounded-full shadow-lg hover:bg-violet-700 transition-all duration-300"
            title="Talk to Live AI Advisor"
          >
              <HeadsetIcon className="h-8 w-8" />
              <span className="absolute right-full mr-3 px-2 py-1 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  Live Advisor
              </span>
          </button>
      </div>
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