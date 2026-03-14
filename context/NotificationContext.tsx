import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface NotificationContextType {
  isSupported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  subscription: PushSubscription | null;
  requestPermission: () => Promise<boolean>;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  sendNotification: (title: string, options?: NotificationOptions) => void;
  scheduleNotification: (title: string, options: NotificationOptions, delay: number) => void;
  notifications: NotificationMessage[];
  markAsRead: (id: string) => void;
  clearNotifications: () => void;
}

export interface NotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  vibrate?: number[];
  data?: any;
  actions?: NotificationAction[];
}

export interface NotificationMessage {
  id: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  timestamp: Date;
  read: boolean;
  data?: any;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotifications = () => {
  const context = React.useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);

  // Check if notifications are supported
  useEffect(() => {
    const checkSupport = () => {
      const supported = 'Notification' in window && 
                       'serviceWorker' in navigator && 
                       'PushManager' in window;
      setIsSupported(supported);
      
      if (supported) {
        setPermission(Notification.permission);
        loadExistingNotifications();
        checkExistingSubscription();
      }
    };

    checkSupport();
  }, []);

  // Load existing notifications from localStorage
  const loadExistingNotifications = () => {
    try {
      const stored = localStorage.getItem('notifications');
      if (stored) {
        const notifs = JSON.parse(stored).map((notif: any) => ({
          ...notif,
          timestamp: new Date(notif.timestamp)
        }));
        setNotifications(notifs);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  // Save notifications to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('notifications', JSON.stringify(notifications));
    } catch (error) {
      console.error('Failed to save notifications:', error);
    }
  }, [notifications]);

  // Check existing push subscription
  const checkExistingSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();
      
      if (existingSubscription) {
        setSubscription(existingSubscription);
        setIsSubscribed(true);
      }
    } catch (error) {
      console.error('Failed to check existing subscription:', error);
    }
  };

  // Request notification permission
  const requestPermission = async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('Failed to request permission:', error);
      return false;
    }
  };

  // Subscribe to push notifications
  const subscribe = async (): Promise<boolean> => {
    if (!isSupported || permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        return false;
      }
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      // In a real app, you would get this from your server
      const applicationServerKey = urlB64ToUint8Array(
        'BEl62iUYgUivxIkv69yViEuiBIaIb-Q-SgIdkQFzoygUeYaZ1di0MlTctwpcxIs5wBbr4KJxNv2Y_QIjLZ1tVQ'
      );

      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array(applicationServerKey)
      });

      setSubscription(pushSubscription);
      setIsSubscribed(true);

      // Send subscription to server
      await sendSubscriptionToServer(pushSubscription);

      return true;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      return false;
    }
  };

  // Unsubscribe from push notifications
  const unsubscribe = async (): Promise<boolean> => {
    if (!subscription) {
      return true;
    }

    try {
      await subscription.unsubscribe();
      setSubscription(null);
      setIsSubscribed(false);

      // Remove subscription from server
      await removeSubscriptionFromServer(subscription);

      return true;
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
      return false;
    }
  };

  // Send local notification
  const sendNotification = (title: string, options: NotificationOptions = {}) => {
    if (!isSupported || permission !== 'granted') {
      return;
    }

    const notification = new Notification(title, {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      vibrate: [100, 50, 100],
      ...options
    });

    // Add to in-app notifications
    const message: NotificationMessage = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      body: options.body || '',
      icon: options.icon,
      badge: options.badge,
      timestamp: new Date(),
      read: false,
      data: options.data,
      actions: options.actions
    };

    setNotifications(prev => [message, ...prev].slice(0, 50)); // Keep only last 50

    // Handle notification click
    notification.onclick = (event) => {
      event.preventDefault();
      if (options.data?.url) {
        window.open(options.data.url, '_blank');
      }
      notification.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);
  };

  // Schedule notification for later
  const scheduleNotification = (title: string, options: NotificationOptions, delay: number) => {
    setTimeout(() => {
      sendNotification(title, options);
    }, delay);
  };

  // Mark notification as read
  const markAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(notif => 
        notif.id === id ? { ...notif, read: true } : notif
      )
    );
  };

  // Clear all notifications
  const clearNotifications = () => {
    setNotifications([]);
  };

  // Send subscription to server
  const sendSubscriptionToServer = async (subscription: PushSubscription) => {
    try {
      // In a real app, you would send this to your backend
      // eslint-disable-next-line no-console
      console.log('Sending subscription to server:', subscription);
      
      // Example API call:
      // await fetch('/api/notifications/subscribe', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(subscription)
      // });
    } catch (error) {
      console.error('Failed to send subscription to server:', error);
    }
  };

  // Remove subscription from server
  const removeSubscriptionFromServer = async (subscription: PushSubscription) => {
    try {
      // In a real app, you would send this to your backend
      // eslint-disable-next-line no-console
      console.log('Removing subscription from server:', subscription);
      
      // Example API call:
      // await fetch('/api/notifications/unsubscribe', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(subscription)
      // });
    } catch (error) {
      console.error('Failed to remove subscription from server:', error);
    }
  };

  // Utility function to convert base64 to Uint8Array
  function urlB64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const value: NotificationContextType = {
    isSupported,
    permission,
    isSubscribed,
    subscription,
    requestPermission,
    subscribe,
    unsubscribe,
    sendNotification,
    scheduleNotification,
    notifications,
    markAsRead,
    clearNotifications
  };

  return React.createElement(
    NotificationContext.Provider,
    { value },
    children
  );
};

export default NotificationContext;
