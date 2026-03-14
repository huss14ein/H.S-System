import React from 'react';
import { useNotifications } from '../context/NotificationContext';

interface NotificationBellProps {
  className?: string;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ className = '' }) => {
  const { notifications, isSupported, permission, requestPermission, markAsRead, clearNotifications } = useNotifications();

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (granted) {
      // Send a welcome notification
      const { sendNotification } = useNotifications();
      sendNotification('Notifications Enabled!', {
        body: 'You\'ll now receive important financial updates.',
        icon: '/icons/bell-192x192.png'
      });
    }
  };

  if (!isSupported) {
    return null;
  }

  if (permission === 'default') {
    return React.createElement(
      'button',
      {
        onClick: handleRequestPermission,
        className: `p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors ${className}`,
        title: 'Enable notifications'
      },
      [
        React.createElement(
          'svg',
          { key: 'icon', className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { 
            strokeLinecap: 'round', 
            strokeLinejoin: 'round', 
            strokeWidth: 2, 
            d: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' 
          })
        ),
        React.createElement(
          'span',
          { key: 'text', className: 'ml-2 text-sm' },
          'Enable'
        )
      ]
    );
  }

  if (permission === 'denied') {
    return null;
  }

  return React.createElement(
    'div',
    { className: `relative ${className}` },
    [
      React.createElement(
        'button',
        {
          key: 'bell-button',
          className: 'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors relative',
          title: `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
        },
        [
          React.createElement(
            'svg',
            { 
              key: 'bell-icon',
              className: 'w-5 h-5', 
              fill: 'none', 
              stroke: 'currentColor', 
              viewBox: '0 0 24 24' 
            },
            React.createElement('path', { 
              strokeLinecap: 'round', 
              strokeLinejoin: 'round', 
              strokeWidth: 2, 
              d: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' 
            })
          ),
          unreadCount > 0 && React.createElement(
            'span',
            {
              key: 'badge',
              className: 'absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold'
            },
            unreadCount > 99 ? '99+' : unreadCount.toString()
          )
        ]
      ),
      
      // Notification dropdown
      unreadCount > 0 && React.createElement(
        'div',
        {
          key: 'dropdown',
          className: 'absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50'
        },
        [
          React.createElement(
            'div',
            {
              key: 'header',
              className: 'flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'
            },
            [
              React.createElement(
                'h3',
                { key: 'title', className: 'font-semibold text-gray-900 dark:text-white' },
                'Notifications'
              ),
              React.createElement(
                'button',
                {
                  key: 'clear',
                  onClick: clearNotifications,
                  className: 'text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                },
                'Clear All'
              )
            ]
          ),
          
          React.createElement(
            'div',
            {
              key: 'notifications',
              className: 'max-h-96 overflow-y-auto'
            },
            notifications.slice(0, 10).map(notif =>
              React.createElement(
                'div',
                {
                  key: notif.id,
                  className: `p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${!notif.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`,
                  onClick: () => markAsRead(notif.id)
                },
                [
                  React.createElement(
                    'div',
                    { key: 'content', className: 'flex items-start space-x-3' },
                    [
                      notif.icon && React.createElement(
                        'img',
                        {
                          key: 'icon',
                          src: notif.icon,
                          alt: '',
                          className: 'w-8 h-8 rounded-full'
                        }
                      ),
                      React.createElement(
                        'div',
                        { key: 'text', className: 'flex-1 min-w-0' },
                        [
                          React.createElement(
                            'p',
                            { key: 'title', className: 'text-sm font-medium text-gray-900 dark:text-white truncate' },
                            notif.title
                          ),
                          React.createElement(
                            'p',
                            { key: 'body', className: 'text-sm text-gray-600 dark:text-gray-300 mt-1' },
                            notif.body
                          ),
                          React.createElement(
                            'p',
                            { key: 'time', className: 'text-xs text-gray-500 dark:text-gray-400 mt-1' },
                            formatTime(notif.timestamp)
                          )
                        ]
                      ),
                      !notif.read && React.createElement(
                        'div',
                        {
                          key: 'indicator',
                          className: 'w-2 h-2 bg-blue-500 rounded-full mt-2'
                        }
                      )
                    ]
                  )
                ]
              )
            )
          ),
          
          notifications.length > 10 && React.createElement(
            'div',
            {
              key: 'footer',
              className: 'p-3 text-center text-sm text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700'
            },
            `Showing 10 of ${notifications.length} notifications`
          )
        ]
      )
    ]
  );
};

const formatTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
};

export default NotificationBell;
