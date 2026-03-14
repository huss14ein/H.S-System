import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface Widget {
  id: string;
  type: 'balance' | 'budget' | 'goals' | 'investments' | 'transactions' | 'savings';
  title: string;
  size: 'small' | 'medium' | 'large';
  position: { x: number; y: number };
  enabled: boolean;
  config?: Record<string, any>;
}

export interface WidgetContextType {
  widgets: Widget[];
  addWidget: (widget: Omit<Widget, 'id'>) => void;
  removeWidget: (id: string) => void;
  updateWidget: (id: string, updates: Partial<Widget>) => void;
  reorderWidgets: (widgets: Widget[]) => void;
  isWidgetEnabled: (type: Widget['type']) => boolean;
  getWidgetData: (type: Widget['type']) => Promise<any>;
  refreshWidget: (id: string) => Promise<void>;
  isInstalled: boolean;
  installPrompt: any;
  installPWA: () => Promise<void>;
}

const WidgetContext = createContext<WidgetContextType | null>(null);

export const useWidgets = () => {
  const context = React.useContext(WidgetContext);
  if (!context) {
    throw new Error('useWidgets must be used within a WidgetProvider');
  }
  return context;
};

interface WidgetProviderProps {
  children: ReactNode;
}

export const WidgetProvider: React.FC<WidgetProviderProps> = ({ children }) => {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  // Check if PWA is installed
  useEffect(() => {
    const checkInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isInWebAppiOS = (window.navigator as any).standalone === true;
      const isInWebAppChrome = window.matchMedia('(display-mode: standalone)').matches;
      
      setIsInstalled(isStandalone || isInWebAppiOS || isInWebAppChrome);
    };

    checkInstalled();

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', () => {});
    };
  }, []);

  // Load widgets from localStorage
  useEffect(() => {
    const loadWidgets = () => {
      try {
        const stored = localStorage.getItem('homeScreenWidgets');
        if (stored) {
          const widgetData = JSON.parse(stored);
          setWidgets(widgetData);
        } else {
          // Initialize with default widgets
          const defaultWidgets: Widget[] = [
            {
              id: 'balance-widget',
              type: 'balance',
              title: 'Account Balance',
              size: 'medium',
              position: { x: 0, y: 0 },
              enabled: true
            },
            {
              id: 'budget-widget',
              type: 'budget',
              title: 'Budget Overview',
              size: 'small',
              position: { x: 1, y: 0 },
              enabled: true
            },
            {
              id: 'goals-widget',
              type: 'goals',
              title: 'Goals Progress',
              size: 'medium',
              position: { x: 0, y: 1 },
              enabled: true
            }
          ];
          setWidgets(defaultWidgets);
        }
      } catch (error) {
        console.error('Failed to load widgets:', error);
      }
    };

    loadWidgets();
  }, []);

  // Save widgets to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('homeScreenWidgets', JSON.stringify(widgets));
    } catch (error) {
      console.error('Failed to save widgets:', error);
    }
  }, [widgets]);

  const addWidget = (widget: Omit<Widget, 'id'>) => {
    const newWidget: Widget = {
      ...widget,
      id: `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    setWidgets(prev => [...prev, newWidget]);
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => prev.filter(widget => widget.id !== id));
  };

  const updateWidget = (id: string, updates: Partial<Widget>) => {
    setWidgets(prev => 
      prev.map(widget => 
        widget.id === id ? { ...widget, ...updates } : widget
      )
    );
  };

  const reorderWidgets = (newOrder: Widget[]) => {
    setWidgets(newOrder);
  };

  const isWidgetEnabled = (type: Widget['type']) => {
    return widgets.some(widget => widget.type === type && widget.enabled);
  };

  const getWidgetData = async (type: Widget['type']) => {
    // Simulate fetching widget data
    switch (type) {
      case 'balance':
        return {
          totalBalance: 125750.50,
          change: 2.5,
          accounts: [
            { name: 'Checking', balance: 5000.50 },
            { name: 'Savings', balance: 25000.00 },
            { name: 'Investment', balance: 95750.00 }
          ]
        };
      
      case 'budget':
        return {
          totalBudget: 5000,
          spent: 3200,
          remaining: 1800,
          percentage: 64,
          categories: [
            { name: 'Food', budget: 800, spent: 650 },
            { name: 'Transport', budget: 400, spent: 320 },
            { name: 'Entertainment', budget: 300, spent: 280 }
          ]
        };
      
      case 'goals':
        return {
          totalGoals: 5,
          completedGoals: 2,
          inProgressGoals: 3,
          goals: [
            { name: 'Emergency Fund', target: 10000, current: 7500, percentage: 75 },
            { name: 'Vacation', target: 5000, current: 2000, percentage: 40 },
            { name: 'New Car', target: 25000, current: 8000, percentage: 32 }
          ]
        };
      
      case 'investments':
        return {
          totalValue: 95750.00,
          dayChange: 1250.50,
          dayChangePercentage: 1.32,
          portfolio: [
            { name: 'Stocks', value: 60000, percentage: 62.7 },
            { name: 'Bonds', value: 25000, percentage: 26.1 },
            { name: 'Real Estate', value: 10750, percentage: 11.2 }
          ]
        };
      
      case 'transactions':
        return {
          todayTransactions: 3,
          totalToday: 156.75,
          recentTransactions: [
            { name: 'Coffee Shop', amount: 4.50, time: '9:30 AM' },
            { name: 'Gas Station', amount: 45.00, time: '12:15 PM' },
            { name: 'Grocery Store', amount: 107.25, time: '6:45 PM' }
          ]
        };
      
      case 'savings':
        return {
          totalSavings: 30000,
          monthlySavings: 2500,
          yearlyGoal: 30000,
          goalProgress: 100,
          savingsRate: 20
        };
      
      default:
        return null;
    }
  };

  const refreshWidget = async (id: string) => {
    const widget = widgets.find(w => w.id === id);
    if (widget) {
      // Trigger a refresh by updating the widget with a timestamp
      updateWidget(id, { 
        config: { 
          ...widget.config, 
          lastRefresh: new Date().toISOString() 
        } 
      });
    }
  };

  const installPWA = async () => {
    if (!installPrompt) {
      return;
    }

    try {
      const result = await installPrompt.prompt();
      if (result.outcome === 'accepted') {
        setInstallPrompt(null);
      }
    } catch (error) {
      console.error('PWA installation failed:', error);
    }
  };

  const value: WidgetContextType = {
    widgets,
    addWidget,
    removeWidget,
    updateWidget,
    reorderWidgets,
    isWidgetEnabled,
    getWidgetData,
    refreshWidget,
    isInstalled,
    installPrompt,
    installPWA
  };

  return React.createElement(
    WidgetContext.Provider,
    { value },
    children
  );
};

export default WidgetContext;
