import React, { useState, useMemo, useContext } from 'react';
import { Page } from '../types';
import { DataContext } from '../context/DataContext';
import { ExclamationTriangleIcon } from '../components/icons/ExclamationTriangleIcon';
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { BellAlertIcon } from '../components/icons/BellAlertIcon';
import { CheckCircleIcon } from '../components/icons/CheckCircleIcon';
import { useMarketData } from '../context/MarketDataContext';

type NotificationType = 'Budget' | 'Goal' | 'Investment';
interface Notification {
    id: string;
    type: NotificationType;
    message: string;
    date: string;
    isRead: boolean;
    pageLink: Page;
}

const NotificationIcon: React.FC<{ type: NotificationType }> = ({ type }) => {
    const iconClass = "h-6 w-6";
    switch(type) {
        case 'Budget': return <ExclamationTriangleIcon className={`${iconClass} text-yellow-500`} />;
        case 'Goal': return <TrophyIcon className={`${iconClass} text-blue-500`} />;
        case 'Investment': return <BellAlertIcon className={`${iconClass} text-purple-500`} />;
        default: return null;
    }
};

const Notifications: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
    const { data } = useContext(DataContext)!;
    const { simulatedPrices } = useMarketData();
    const [filter, setFilter] = useState<'All' | 'Unread'>('All');
    
    // In a real app, notifications would come from a dedicated source.
    // Here, we generate them dynamically based on user data for demonstration.
    const allNotifications = useMemo<Notification[]>(() => {
        const notifications: Notification[] = [];
        const now = new Date();
        
        // Static notifications for demonstration
        notifications.push({ id: 'static-1', type: 'Budget', message: 'Your "Food" budget is at 95%.', date: new Date().toISOString(), isRead: false, pageLink: 'Budgets' });
        notifications.push({ id: 'static-2', type: 'Goal', message: 'Goal "World Trip" is at risk of not meeting its deadline.', date: new Date(Date.now() - 86400000).toISOString(), isRead: true, pageLink: 'Goals' });

        // Dynamic price alerts
        data.priceAlerts.filter(a => a.status === 'triggered').forEach(alert => {
             notifications.push({ id: `price-${alert.id}`, type: 'Investment', message: `${alert.symbol} has reached your target price.`, date: alert.createdAt, isRead: false, pageLink: 'Investments' });
        });
        
        // Dynamic planned trade alerts
        data.plannedTrades
            .filter(p => p.status === 'Planned' && p.conditionType === 'price')
            .forEach(plan => {
                const priceInfo = simulatedPrices[plan.symbol];
                if (!priceInfo) return;

                const hasTriggered = (plan.tradeType === 'buy' && priceInfo.price <= plan.targetValue) || (plan.tradeType === 'sell' && priceInfo.price >= plan.targetValue);
                if (hasTriggered) {
                     notifications.push({
                        id: `plan-${plan.id}`,
                        type: 'Investment',
                        message: `Target Price Met: Your plan to ${plan.tradeType} ${plan.name} is ready to execute.`,
                        date: now.toISOString(),
                        isRead: false,
                        pageLink: 'Investments'
                    });
                }
            });


        return notifications.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [data.priceAlerts, data.plannedTrades, simulatedPrices]);
    
    const [notifications, setNotifications] = useState<Notification[]>(allNotifications);

    const filteredNotifications = useMemo(() => {
        if (filter === 'Unread') {
            return notifications.filter(n => !n.isRead);
        }
        return notifications;
    }, [notifications, filter]);

    const handleMarkAsRead = (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    };

    const handleMarkAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    };
    
    const handleNotificationClick = (notification: Notification) => {
        handleMarkAsRead(notification.id);
        setActivePage(notification.pageLink);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-dark">Notifications</h1>
                <button onClick={handleMarkAllAsRead} className="text-sm font-medium text-primary hover:underline">Mark all as read</button>
            </div>

            <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {(['All', 'Unread'] as const).map(tab => (
                        <button key={tab} onClick={() => setFilter(tab)}
                            className={`${filter === tab ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>
                            {tab}
                        </button>
                    ))}
                </nav>
            </div>
            
            <div className="bg-white shadow rounded-lg">
                <ul className="divide-y divide-gray-200">
                    {filteredNotifications.map(notification => (
                        <li key={notification.id} className={`p-4 transition-colors ${!notification.isRead ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                           <div className="flex items-start space-x-4">
                                <div className="flex-shrink-0">
                                   <NotificationIcon type={notification.type} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-dark truncate">{notification.message}</p>
                                    <p className="text-sm text-gray-500">{new Date(notification.date).toLocaleString()}</p>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <button onClick={() => handleNotificationClick(notification)} className="text-sm font-semibold text-primary hover:underline">View</button>
                                     {!notification.isRead && (
                                        <button onClick={() => handleMarkAsRead(notification.id)} title="Mark as read">
                                            <CheckCircleIcon className="h-5 w-5 text-gray-400 hover:text-green-500" />
                                        </button>
                                     )}
                                </div>
                           </div>
                        </li>
                    ))}
                    {filteredNotifications.length === 0 && (
                        <li className="p-8 text-center text-gray-500">
                            You're all caught up!
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default Notifications;
