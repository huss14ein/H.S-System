import React, { useState, useContext, useRef, useEffect } from 'react';
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

// Mock static alerts data
const staticAlerts = [
    { id: 'static-1', message: 'Your "Food" budget is at 95%.', type: 'warning' },
    { id: 'static-2', message: 'Goal "World Trip" is at risk of not meeting its deadline.', type: 'danger' },
    { id: 'static-3', message: 'Upcoming payment: Mortgage (SAR 5,000) in 3 days.', type: 'warning' },
];

const Header: React.FC<HeaderProps> = ({ activePage, setActivePage }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [enableEmails, setEnableEmails] = useState(true);
  const [alerts, setAlerts] = useState(staticAlerts);
  
  const auth = useContext(AuthContext);
  const { data, resetData } = useContext(DataContext)!;
  const { currency, setCurrency } = useCurrency();
  const profileRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (alertsRef.current && !alertsRef.current.contains(event.target as Node)) {
        setIsAlertsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  useEffect(() => {
    if(!data) return;
    const triggeredPriceAlerts = data.priceAlerts
      .filter(alert => alert.status === 'triggered')
      .map(alert => ({
        id: `price-alert-${alert.id}`,
        message: `${alert.symbol} has reached your target price of ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR' }).format(alert.targetPrice)}.`,
        type: 'info',
      }));

    // Combine static and dynamic alerts, removing duplicates
    const allAlerts = [...staticAlerts];
    triggeredPriceAlerts.forEach(pa => {
        if (!allAlerts.some(a => a.id === pa.id)) {
            allAlerts.unshift(pa);
        }
    });
    setAlerts(allAlerts);

  }, [data?.priceAlerts]);

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
            {/* Alerts Dropdown */}
            <div className="relative" ref={alertsRef}>
                <button onClick={() => setIsAlertsOpen(!isAlertsOpen)} className="relative p-1">
                    <BellIcon className="h-6 w-6 text-gray-500 hover:text-primary" />
                    {alerts.length > 0 && (
                        <span className="absolute top-0 right-0 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-danger text-white text-xs items-center justify-center">{alerts.length}</span>
                        </span>
                    )}
                </button>
                {isAlertsOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5">
                        <div className="px-4 py-2 font-semibold text-dark border-b">Notifications</div>
                        <ul className="max-h-80 overflow-y-auto">
                            {alerts.map(alert => (
                                <li key={alert.id} className="border-b last:border-b-0">
                                    <button className="w-full text-left block p-3 hover:bg-gray-100 text-sm">
                                        <p className="font-medium text-gray-800">{alert.message}</p>
                                        <p className="text-xs text-gray-500 mt-1">{alert.type === 'warning' ? 'Action recommended' : (alert.type === 'danger' ? 'Urgent attention required' : 'For your information')}</p>
                                    </button>
                                </li>
                            ))}
                        </ul>
                         <div className="px-4 py-2 border-t">
                            <button className="text-sm text-primary hover:underline font-medium">View all notifications</button>
                        </div>
                    </div>
                )}
            </div>
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
                    <div className="px-4 py-3">
                    <label htmlFor="email-toggle" className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm text-gray-700">Weekly Email Reports</span>
                        <div className="relative">
                            <input id="email-toggle" type="checkbox" className="sr-only" checked={enableEmails} onChange={() => setEnableEmails(!enableEmails)} />
                            <div className={`block w-10 h-6 rounded-full transition ${enableEmails ? 'bg-primary' : 'bg-gray-200'}`}></div>
                            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition ${enableEmails ? 'transform translate-x-full' : ''}`}></div>
                        </div>
                    </label>
                    </div>
                    <div className="border-t border-gray-100"></div>
                     <button
                        onClick={resetData}
                        className="block w-full text-left px-4 py-2 text-sm text-yellow-700 hover:bg-yellow-100"
                    >
                        Reset Demo Data
                    </button>
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