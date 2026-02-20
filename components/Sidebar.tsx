import React from 'react';
import { Page } from '../types';
import { NAVIGATION_ITEMS } from '../constants';
import { HSLogo } from './icons/HSLogo';

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage }) => {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto scrollbar-hide">
      <div className="p-6 flex items-center space-x-3">
        <HSLogo className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-bold text-dark tracking-tight">H.S Wealth</h1>
      </div>
      
      <nav className="flex-1 px-4 space-y-1 pb-8">
        {NAVIGATION_ITEMS.map((item) => {
          const isActive = activePage === item.name;
          return (
            <button
              key={item.name}
              onClick={() => setActivePage(item.name)}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon
                className={`mr-3 h-5 w-5 flex-shrink-0 transition-colors ${
                  isActive ? 'text-primary' : 'text-gray-400 group-hover:text-gray-600'
                }`}
              />
              <span className="truncate">{item.name}</span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-gray-100">
        <div className="bg-slate-50 rounded-2xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Market Status</p>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-700">Live Updates</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
