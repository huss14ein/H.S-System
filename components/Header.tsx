import React, { useState, useContext, useMemo } from 'react';
import { Page } from '../types';
import { NAVIGATION_ITEMS } from '../constants';
import { HSLogo } from './icons/HSLogo';
import { AuthContext } from '../context/AuthContext';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { BellIcon } from './icons/BellIcon';
import { useCurrency } from '../context/CurrencyContext';
import { DataContext } from '../context/DataContext';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import useClickOutside from '../hooks/useClickOutside';
import { Bars3Icon } from './icons/Bars3Icon';
import { XMarkIcon } from './icons/XMarkIcon';
import { HeadsetIcon } from './icons/HeadsetIcon';
import { CheckIcon } from './icons/CheckIcon';
import { useAI } from '../context/AiContext';

interface HeaderProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
  onOpenLiveAdvisor: () => void;
}

const Header: React.FC<HeaderProps> = ({ activePage, setActivePage, onOpenLiveAdvisor }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  
  const auth = useContext(AuthContext);
  const { data, resetData, loadDemoData } = useContext(DataContext)!;
  const { currency, setCurrency } = useCurrency();
  const { isAiAvailable } = useAI();
  
  const profileRef = useClickOutside<HTMLDivElement>(() => setIsProfileOpen(false));
  const currencyRef = useClickOutside<HTMLDivElement>(() => setIsCurrencyOpen(false));

  const hasData = data && data.accounts.length > 0;
  
  const notificationCount = useMemo(() => {
    if (!data) return 0;
    const priceAlerts = data.priceAlerts.filter(a => a.status === 'triggered').length;
    return priceAlerts + 3; // +3 for static alerts
  }, [data]);

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          <div className="flex items-center space-x-4 flex-shrink-0 lg:hidden">
            <HSLogo className="h-8 w-8" />
            <h1 className="text-xl font-bold text-dark">H.S</h1>
          </div>

          <div className="hidden lg:block">
            <h2 className="text-lg font-semibold text-gray-800">{activePage}</h2>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
            {/* Currency Dropdown */}
            <div className="relative hidden sm:block" ref={currencyRef}>
              <button onClick={() => setIsCurrencyOpen(!isCurrencyOpen)} className="flex items-center text-sm font-semibold text-gray-500 hover:text-primary px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
                {currency}
                <ChevronDownIcon className="h-4 w-4 ml-1 opacity-50" />
              </button>
              {isCurrencyOpen && (
                <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-xl py-1.5 ring-1 ring-black ring-opacity-5 border border-gray-100">
                  <button onClick={() => { setCurrency('SAR'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">
                    SAR {currency === 'SAR' && <CheckIcon className="h-4 w-4 text-primary" />}
                  </button>
                  <button onClick={() => { setCurrency('USD'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">
                    USD {currency === 'USD' && <CheckIcon className="h-4 w-4 text-primary" />}
                  </button>
                </div>
              )}
            </div>
            
            <button onClick={() => setActivePage('Notifications')} className="relative p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
                <BellIcon className="h-6 w-6" />
                {notificationCount > 0 && (
                    <span className="absolute top-2 right-2 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-danger text-white text-[10px] items-center justify-center font-bold">{notificationCount}</span>
                    </span>
                )}
            </button>

            <button
              onClick={onOpenLiveAdvisor}
              className="p-2 rounded-xl text-gray-400 hover:text-primary hover:bg-gray-50 disabled:text-gray-200 disabled:cursor-not-allowed transition-all border border-transparent hover:border-gray-100"
              title={isAiAvailable ? "Live AI Advisor" : "AI features are disabled. Please configure your API key."}
              disabled={!isAiAvailable}
            >
               <HeadsetIcon className="h-6 w-6" />
           </button>
            
            <div className="h-8 w-px bg-gray-100 mx-1 hidden sm:block"></div>

            <div className="relative" ref={profileRef}>
                <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="flex items-center space-x-2 p-1 rounded-xl text-gray-500 hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
                    <UserCircleIcon className="h-8 w-8 text-gray-400" />
                    <ChevronDownIcon className={`h-4 w-4 opacity-50 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>
                {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl py-2 ring-1 ring-black ring-opacity-5 border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-gray-100">
                      <p className="text-sm font-bold text-gray-900 truncate">{auth?.user?.email}</p>
                      <p className="text-gray-500 text-[10px] font-mono truncate mt-0.5 opacity-60">{auth?.user?.id}</p>
                    </div>
                    <div className="py-1">
                      <button onClick={() => { setActivePage('Settings'); setIsProfileOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">Settings</button>
                      {hasData ? (
                        <button onClick={() => { resetData(); setIsProfileOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">Clear All My Data</button>
                      ) : (
                        <button onClick={() => { loadDemoData(); setIsProfileOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-primary hover:bg-primary/5 transition-colors">Load Demo Data</button>
                      )}
                    </div>
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button onClick={auth?.logout} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors font-medium">Logout</button>
                    </div>
                </div>
                )}
            </div>

            <div className="lg:hidden">
              <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-50 border border-transparent hover:border-gray-100">
                <Bars3Icon className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-white md:hidden">
            <div className="px-4 pt-4 flex justify-between items-center">
                <div className="flex items-center space-x-2"><HSLogo className="h-8 w-8" /><h1 className="text-xl font-bold text-dark">H.S</h1></div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-gray-500"><XMarkIcon className="h-6 w-6" /></button>
            </div>
            <div className="mt-6 px-2 space-y-1">
                {NAVIGATION_ITEMS.map(item => (
                    <button key={item.name} onClick={() => { setActivePage(item.name); setIsMobileMenuOpen(false); }}
                        className={`w-full flex items-center px-3 py-3 text-base font-medium rounded-md ${activePage === item.name ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                        <item.icon className={`mr-3 h-6 w-6 ${activePage === item.name ? 'text-white' : 'text-gray-400'}`} />
                        {item.name}
                    </button>
                ))}
            </div>
        </div>
      )}
    </header>
  );
};

export default Header;