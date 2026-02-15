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
  
  const profileRef = useClickOutside<HTMLDivElement>(() => setIsProfileOpen(false));
  const currencyRef = useClickOutside<HTMLDivElement>(() => setIsCurrencyOpen(false));

  const hasData = data && data.accounts.length > 0;
  
  const notificationCount = useMemo(() => {
    if (!data) return 0;
    const priceAlerts = data.priceAlerts.filter(a => a.status === 'triggered').length;
    return priceAlerts + 3; // +3 for static alerts
  }, [data]);

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          <div className="flex items-center space-x-4 flex-shrink-0">
            <HSLogo className="h-8 w-8" />
            <h1 className="text-xl font-bold text-dark hidden sm:block">H.S</h1>
          </div>

          <nav className="hidden md:block flex-1 min-w-0 px-4 lg:px-8">
            <div className="flex items-center space-x-2 overflow-x-auto overflow-y-hidden py-2 scrollbar-hide">
              {NAVIGATION_ITEMS.map(item => (
                <button
                  key={item.name}
                  onClick={() => setActivePage(item.name)}
                  className={`flex items-center whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activePage === item.name 
                      ? 'bg-gray-100 text-primary font-semibold' 
                      : 'text-gray-600 hover:bg-gray-100 hover:text-dark'
                  }`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </nav>
          
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            {/* Currency Dropdown */}
            <div className="relative hidden md:block" ref={currencyRef}>
              <button onClick={() => setIsCurrencyOpen(!isCurrencyOpen)} className="flex items-center text-sm font-medium text-gray-600 hover:text-primary p-2 rounded-full hover:bg-gray-100 transition-colors">
                {currency}
                <ChevronDownIcon className="h-4 w-4 ml-1 opacity-70" />
              </button>
              {isCurrencyOpen && (
                <div className="absolute right-0 mt-2 w-28 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5">
                  <button onClick={() => { setCurrency('SAR'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
                    SAR {currency === 'SAR' && <CheckIcon className="h-4 w-4 text-primary" />}
                  </button>
                  <button onClick={() => { setCurrency('USD'); setIsCurrencyOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between">
                    USD {currency === 'USD' && <CheckIcon className="h-4 w-4 text-primary" />}
                  </button>
                </div>
              )}
            </div>
            
            <button onClick={() => setActivePage('Notifications')} className="relative p-2 rounded-full text-gray-500 hover:text-primary hover:bg-gray-100 transition-colors">
                <BellIcon className="h-6 w-6" />
                {notificationCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-danger text-white text-xs items-center justify-center">{notificationCount}</span>
                    </span>
                )}
            </button>

            <button onClick={onOpenLiveAdvisor} className="p-2 rounded-full text-gray-500 hover:text-primary hover:bg-gray-100 transition-colors" title="Live AI Advisor">
               <HeadsetIcon className="h-6 w-6" />
           </button>
            
            <div className="relative" ref={profileRef}>
                <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="p-1 rounded-full text-gray-500 hover:text-primary hover:bg-gray-100 transition-colors">
                    <UserCircleIcon className="h-8 w-8" />
                </button>
                {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5">
                    <div className="px-4 py-2 text-sm text-gray-700"><p className="font-medium">{auth?.user?.email}</p><p className="text-gray-500 text-xs truncate">{auth?.user?.id}</p></div>
                    <div className="border-t border-gray-100"></div>
                    <button onClick={() => { setActivePage('Settings'); setIsProfileOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Settings</button>
                    {hasData ? (<button onClick={resetData} className="block w-full text-left px-4 py-2 text-sm text-yellow-700 hover:bg-yellow-100">Clear All My Data</button>) 
                    : (<button onClick={loadDemoData} className="block w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-blue-100">Load Demo Data</button>)}
                    <div className="border-t border-gray-100"></div>
                    <button onClick={auth?.logout} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Logout</button>
                </div>
                )}
            </div>

            <div className="md:hidden">
              <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-md text-gray-500 hover:bg-gray-100">
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