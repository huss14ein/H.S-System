import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface OfflineContextType {
  isOnline: boolean;
  isOffline: boolean;
  pendingActions: OfflineAction[];
  addOfflineAction: (action: OfflineAction) => void;
  removeOfflineAction: (id: string) => void;
  syncPendingActions: () => Promise<void>;
  connectionType: string;
  lastSyncTime: Date | null;
}

export interface OfflineAction {
  id: string;
  type: 'transaction' | 'budget' | 'goal' | 'account';
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  data: any;
  timestamp: Date;
  retryCount: number;
}

const OfflineContext = createContext<OfflineContextType | null>(null);

export const useOffline = () => {
  const context = React.useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};

interface OfflineProviderProps {
  children: ReactNode;
}

export const OfflineProvider: React.FC<OfflineProviderProps> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionType, setConnectionType] = useState('unknown');
  const [pendingActions, setPendingActions] = useState<OfflineAction[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Monitor connection status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      updateConnectionType();
      // Auto-sync when coming back online
      syncPendingActions();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnectionType('offline');
    };

    const updateConnectionType = () => {
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        setConnectionType(connection?.effectiveType || 'unknown');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    updateConnectionType();

    // Listen for connection type changes
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connection?.addEventListener('change', updateConnectionType);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        connection?.removeEventListener('change', updateConnectionType);
      }
    };
  }, []);

  // Load pending actions from localStorage
  useEffect(() => {
    const loadPendingActions = () => {
      try {
        const stored = localStorage.getItem('offlineActions');
        if (stored) {
          const actions = JSON.parse(stored).map((action: any) => ({
            ...action,
            timestamp: new Date(action.timestamp)
          }));
          setPendingActions(actions);
        }

        const lastSync = localStorage.getItem('lastSyncTime');
        if (lastSync) {
          setLastSyncTime(new Date(lastSync));
        }
      } catch (error) {
        console.error('Failed to load offline actions:', error);
      }
    };

    loadPendingActions();
  }, []);

  // Save pending actions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('offlineActions', JSON.stringify(pendingActions));
    } catch (error) {
      console.error('Failed to save offline actions:', error);
    }
  }, [pendingActions]);

  // Save last sync time
  useEffect(() => {
    if (lastSyncTime) {
      localStorage.setItem('lastSyncTime', lastSyncTime.toISOString());
    }
  }, [lastSyncTime]);

  const addOfflineAction = (action: Omit<OfflineAction, 'id' | 'timestamp' | 'retryCount'>) => {
    const newAction: OfflineAction = {
      ...action,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      retryCount: 0
    };

    setPendingActions(prev => [...prev, newAction]);

    // Show notification if supported
    if ('serviceWorker' in navigator && 'Notification' in window) {
      showOfflineNotification(newAction);
    }
  };

  const removeOfflineAction = (id: string) => {
    setPendingActions(prev => prev.filter(action => action.id !== id));
  };

  const syncPendingActions = async () => {
    if (!isOnline || pendingActions.length === 0) {
      return;
    }

    const actionsToSync = [...pendingActions];
    const syncedActions: string[] = [];
    const failedActions: string[] = [];

    for (const action of actionsToSync) {
      try {
        const response = await fetch(action.url, {
          method: action.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(action.data)
        });

        if (response.ok) {
          syncedActions.push(action.id);
        } else {
          failedActions.push(action.id);
        }
      } catch (error) {
        console.error('Failed to sync action:', action, error);
        failedActions.push(action.id);
      }
    }

    // Update pending actions
    setPendingActions(prev => {
      const updated = prev.filter(action => !syncedActions.includes(action.id));
      
      // Increment retry count for failed actions
      return updated.map(action => {
        if (failedActions.includes(action.id)) {
          return { ...action, retryCount: action.retryCount + 1 };
        }
        return action;
      });
    });

    // Update last sync time if any actions were synced
    if (syncedActions.length > 0) {
      setLastSyncTime(new Date());
      
      // Show success notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('H.S Finance', {
          body: `Synced ${syncedActions.length} action(s) successfully`,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/badge-72x72.png'
        });
      }
    }

    // Remove actions that have failed too many times
    setPendingActions(prev => 
      prev.filter(action => action.retryCount < 5)
    );
  };

  const showOfflineNotification = (action: OfflineAction) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('H.S Finance - Offline Mode', {
        body: `Your ${action.type} will sync when you're back online`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        tag: 'offline-action'
      });
    }
  };

  const value: OfflineContextType = {
    isOnline,
    isOffline: !isOnline,
    pendingActions,
    addOfflineAction,
    removeOfflineAction,
    syncPendingActions,
    connectionType,
    lastSyncTime
  };

  return React.createElement(
    OfflineContext.Provider,
    { value },
    children
  );
};

export default OfflineContext;
