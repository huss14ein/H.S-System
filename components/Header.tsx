import React, { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { Page } from '../types';
import { NAVIGATION_ITEMS } from '../constants';
import { HSLogo } from './icons/HSLogo';
import { AuthContext } from '../context/AuthContext';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { BellIcon } from './icons/BellIcon';
import { useCurrency } from '../context/CurrencyContext';
import { DataContext } from '../context/DataContext';

interface HeaderProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
}

const Header: React.FC<HeaderProps> = ({ activePage, setActivePage }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  
  const auth = useContext(AuthContext);
  const { data, resetData, loadDemoData } = useContext(DataContext)!;
  const { currency, setCurrency } = useCurrency();
  const profileRef = useRef<HTMLDivElement>(null);

  const hasData = data && data.accounts.length > 0;
  
  const notificationCount = useMemo(() => {
    if (!data) return 0;
    const priceAlerts = data.priceAlerts.filter(a => a.status === 'triggered').length;
    // You can add more notification types here in the future
    return priceAlerts + 3; // +3 for static alerts
  }, [data]);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const renderNavItem = (item: { name: Page; icon: React.FC<React.SVGProps<SVGSVGElement>> }) => (
    <button
        key={item.name}
        onClick={() => setActivePage(item.name)}
        className={`flex flex-col items-center justify-center px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-gray-200 focus:ring-primary transition-colors ${
            activePage === item.name ? 'ring-2 ring-primary' : ''
        }`}
    >
        <item.icon className="h-8 w-8 mb-1 text-black" />
        <span className="text-xs font-semibold text-black whitespace-nowrap">{item.name}</span>
    </button>
  );

  return (
    <header className="bg-white shadow-sm sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-3">
          <div className="flex items-center space-x-2">
            <HSLogo className="h-8 w-8" />
            <h1 className="text-xl font-bold text-dark hidden sm:block">H.S</h1>
          </div>
          <div className="flex items-center space-x-4">
            {/* Currency Toggle */}
            <div className="flex items-center p-1 bg-gray-100 rounded-full">
                <button
                    onClick={() => setCurrency('SAR')}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${currency === 'SAR' ? 'bg-white text-primary shadow' : 'text-gray-500'}`}
                >
                    SAR
                </button>
                <button
                    onClick={() => setCurrency('USD')}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${currency === 'USD' ? 'bg-white text-primary shadow' : 'text-gray-500'}`}
                >
                    USD
                </button>
            </div>
            {/* Notifications Button */}
            <button onClick={() => setActivePage('Notifications')} className="relative p-1">
                <BellIcon className="h-6 w-6 text-gray-500 hover:text-primary" />
                {notificationCount > 0 && (
                    <span className="absolute top-0 right-0 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-danger text-white text-xs items-center justify-center">{notificationCount}</span>
                    </span>
                )}
            </button>
            {/* Profile Dropdown */}
            <div className="relative" ref={profileRef}>
                <button onClick={() => setIsProfileOpen(!isProfileOpen)}>
                <UserCircleIcon className="h-8 w-8 text-gray-500 hover:text-primary" />
                </button>
                {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5">
                    <div className="px-4 py-2 text-sm text-gray-700">
                    <p className="font-medium">{auth?.user?.email}</p>
                    <p className="text-gray-500 text-xs truncate">{auth?.user?.id}</p>
                    </div>
                    <div className="border-t border-gray-100"></div>
                    <button
                        onClick={() => setActivePage('Settings')}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                        Settings
                    </button>
                    {hasData ? (
                        <button
                            onClick={resetData}
                            className="block w-full text-left px-4 py-2 text-sm text-yellow-700 hover:bg-yellow-100"
                        >
                            Clear All My Data
                        </button>
                    ) : (
                         <button
                            onClick={loadDemoData}
                            className="block w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                        >
                            Load Demo Data
                        </button>
                    )}
                    <div className="border-t border-gray-100"></div>
                    <button
                    onClick={auth?.logout}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                    Logout
                    </button>
                </div>
                )}
            </div>
          </div>
        </div>
      </div>
      <div className="bg-gray-200 p-2 border-t border-b border-gray-300">
          <nav className="flex flex-wrap items-center justify-center gap-2" aria-label="Main navigation">
              {NAVIGATION_ITEMS.map(renderNavItem)}
          </nav>
      </div>
    </header>
  );
};

export default Header;