import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
  tension?: number;
}

export interface DashboardWidget {
  id: string;
  type: 'line' | 'bar' | 'pie' | 'doughnut' | 'radar' | 'polarArea' | 'scatter' | 'bubble' | 'area';
  title: string;
  data: ChartData;
  options?: ChartOptions;
  position: { x: number; y: number; width: number; height: number };
  refreshInterval?: number;
  lastUpdated: Date;
}

export interface ChartOptions {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  plugins?: {
    legend?: {
      display?: boolean;
      position?: 'top' | 'bottom' | 'left' | 'right';
    };
    tooltip?: {
      enabled?: boolean;
      mode?: 'index' | 'dataset' | 'point' | 'nearest';
      intersect?: boolean;
    };
  };
  scales?: {
    x?: {
      display?: boolean;
      grid?: {
        display?: boolean;
      };
    };
    y?: {
      display?: boolean;
      grid?: {
        display?: boolean;
      };
      beginAtZero?: boolean;
    };
  };
  animation?: {
    duration?: number;
    easing?: string;
  };
}

export interface DataVisualizationContextType {
  widgets: DashboardWidget[];
  addWidget: (widget: Omit<DashboardWidget, 'id' | 'lastUpdated'>) => void;
  removeWidget: (id: string) => void;
  updateWidget: (id: string, updates: Partial<DashboardWidget>) => void;
  moveWidget: (id: string, position: { x: number; y: number }) => void;
  resizeWidget: (id: string, size: { width: number; height: number }) => void;
  refreshWidget: (id: string) => Promise<void>;
  refreshAllWidgets: () => Promise<void>;
  exportDashboard: () => string;
  importDashboard: (data: string) => void;
  getWidgetData: (type: string) => Promise<ChartData>;
  predefinedCharts: Record<string, ChartData>;
}

const DataVisualizationContext = createContext<DataVisualizationContextType | null>(null);

export const useDataVisualization = () => {
  const context = React.useContext(DataVisualizationContext);
  if (!context) {
    throw new Error('useDataVisualization must be used within a DataVisualizationProvider');
  }
  return context;
};

interface DataVisualizationProviderProps {
  children: ReactNode;
}

export const DataVisualizationProvider: React.FC<DataVisualizationProviderProps> = ({ children }) => {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);

  // predefined chart templates
  const predefinedCharts: Record<string, ChartData> = {
    netWorthOverTime: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        {
          label: 'Net Worth',
          data: [100000, 105000, 110000, 108000, 115000, 120000],
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    },
    expenseBreakdown: {
      labels: ['Housing', 'Food', 'Transport', 'Entertainment', 'Healthcare', 'Other'],
      datasets: [
        {
          label: 'Expenses',
          data: [2000, 800, 400, 300, 200, 300],
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(255, 206, 86, 0.8)',
            'rgba(75, 192, 192, 0.8)',
            'rgba(153, 102, 255, 0.8)',
            'rgba(255, 159, 64, 0.8)'
          ]
        }
      ]
    },
    investmentPerformance: {
      labels: ['Stocks', 'Bonds', 'Real Estate', 'Commodities', 'Cash'],
      datasets: [
        {
          label: 'Portfolio Allocation',
          data: [45, 25, 20, 5, 5],
          backgroundColor: [
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(251, 146, 60, 0.8)',
            'rgba(147, 51, 234, 0.8)',
            'rgba(107, 114, 128, 0.8)'
          ]
        }
      ]
    },
    monthlyCashFlow: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        {
          label: 'Income',
          data: [5000, 5200, 5000, 5500, 5300, 5600],
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: 'rgb(16, 185, 129)',
          borderWidth: 2
        },
        {
          label: 'Expenses',
          data: [3500, 3800, 3200, 3900, 3600, 4000],
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor: 'rgb(239, 68, 68)',
          borderWidth: 2
        }
      ]
    },
    savingsRate: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        {
          label: 'Savings Rate %',
          data: [30, 27, 36, 29, 32, 29],
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'rgba(147, 51, 234, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    },
    debtToIncome: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [
        {
          label: 'Debt-to-Income Ratio',
          data: [0.3, 0.28, 0.25, 0.23, 0.20, 0.18],
          borderColor: 'rgb(251, 146, 60)',
          backgroundColor: 'rgba(251, 146, 60, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    }
  };

  // Load widgets from localStorage
  useEffect(() => {
    const loadWidgets = () => {
      try {
        const stored = localStorage.getItem('dashboardWidgets');
        if (stored) {
          const widgetData = JSON.parse(stored);
          setWidgets(widgetData.map((w: any) => ({
            ...w,
            lastUpdated: new Date(w.lastUpdated)
          })));
        } else {
          // Initialize with default widgets
          const defaultWidgets: DashboardWidget[] = [
            {
              id: 'net-worth-chart',
              type: 'line',
              title: 'Net Worth Over Time',
              data: predefinedCharts.netWorthOverTime,
              position: { x: 0, y: 0, width: 6, height: 4 },
              refreshInterval: 300000, // 5 minutes
              lastUpdated: new Date()
            },
            {
              id: 'expense-breakdown',
              type: 'doughnut',
              title: 'Expense Breakdown',
              data: predefinedCharts.expenseBreakdown,
              position: { x: 6, y: 0, width: 6, height: 4 },
              refreshInterval: 600000, // 10 minutes
              lastUpdated: new Date()
            },
            {
              id: 'monthly-cash-flow',
              type: 'bar',
              title: 'Monthly Cash Flow',
              data: predefinedCharts.monthlyCashFlow,
              position: { x: 0, y: 4, width: 12, height: 4 },
              refreshInterval: 300000, // 5 minutes
              lastUpdated: new Date()
            }
          ];
          setWidgets(defaultWidgets);
        }
      } catch (error) {
        console.error('Failed to load dashboard widgets:', error);
      }
    };

    loadWidgets();
  }, []);

  // Save widgets to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('dashboardWidgets', JSON.stringify(widgets));
    } catch (error) {
      console.error('Failed to save dashboard widgets:', error);
    }
  }, [widgets]);

  // Auto-refresh widgets
  useEffect(() => {
    const interval = setInterval(() => {
      widgets.forEach(widget => {
        if (widget.refreshInterval) {
          const timeSinceUpdate = Date.now() - widget.lastUpdated.getTime();
          if (timeSinceUpdate >= widget.refreshInterval) {
            refreshWidget(widget.id);
          }
        }
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [widgets]);

  const addWidget = (widget: Omit<DashboardWidget, 'id' | 'lastUpdated'>) => {
    const newWidget: DashboardWidget = {
      ...widget,
      id: `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      lastUpdated: new Date()
    };
    setWidgets(prev => [...prev, newWidget]);
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => prev.filter(widget => widget.id !== id));
  };

  const updateWidget = (id: string, updates: Partial<DashboardWidget>) => {
    setWidgets(prev => 
      prev.map(widget => 
        widget.id === id 
          ? { ...widget, ...updates, lastUpdated: new Date() }
          : widget
      )
    );
  };

  const moveWidget = (id: string, position: { x: number; y: number }) => {
    updateWidget(id, { position: { ...widgets.find(w => w.id)!.position, ...position } });
  };

  const resizeWidget = (id: string, size: { width: number; height: number }) => {
    updateWidget(id, { position: { ...widgets.find(w => w.id)!.position, ...size } });
  };

  const refreshWidget = async (id: string) => {
    const widget = widgets.find(w => w.id === id);
    if (!widget) return;

    try {
      const newData = await getWidgetData(widget.type);
      updateWidget(id, { data: newData });
    } catch (error) {
      console.error(`Failed to refresh widget ${id}:`, error);
    }
  };

  const refreshAllWidgets = async () => {
    const refreshPromises = widgets.map(widget => refreshWidget(widget.id));
    await Promise.allSettled(refreshPromises);
  };

  const exportDashboard = (): string => {
    const dashboardData = {
      widgets,
      exportDate: new Date().toISOString(),
      version: '1.0'
    };
    return JSON.stringify(dashboardData, null, 2);
  };

  const importDashboard = (data: string) => {
    try {
      const dashboardData = JSON.parse(data);
      if (dashboardData.widgets && Array.isArray(dashboardData.widgets)) {
        setWidgets(dashboardData.widgets.map((w: any) => ({
          ...w,
          lastUpdated: new Date(w.lastUpdated)
        })));
      }
    } catch (error) {
      console.error('Failed to import dashboard:', error);
    }
  };

  const getWidgetData = async (type: string): Promise<ChartData> => {
    // Simulate API call to fetch fresh data
    await new Promise(resolve => setTimeout(resolve, 1000));

    switch (type) {
      case 'line':
        return {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Updated Data',
            data: [100000 + Math.random() * 20000, 105000 + Math.random() * 20000, 110000 + Math.random() * 20000, 108000 + Math.random() * 20000, 115000 + Math.random() * 20000, 120000 + Math.random() * 20000],
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.4
          }]
        };
      
      case 'bar':
        return {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            {
              label: 'Income',
              data: [5000 + Math.random() * 1000, 5200 + Math.random() * 1000, 5000 + Math.random() * 1000, 5500 + Math.random() * 1000, 5300 + Math.random() * 1000, 5600 + Math.random() * 1000],
              backgroundColor: 'rgba(16, 185, 129, 0.8)',
              borderColor: 'rgb(16, 185, 129)',
              borderWidth: 2
            },
            {
              label: 'Expenses',
              data: [3500 + Math.random() * 500, 3800 + Math.random() * 500, 3200 + Math.random() * 500, 3900 + Math.random() * 500, 3600 + Math.random() * 500, 4000 + Math.random() * 500],
              backgroundColor: 'rgba(239, 68, 68, 0.8)',
              borderColor: 'rgb(239, 68, 68)',
              borderWidth: 2
            }
          ]
        };
      
      case 'pie':
      case 'doughnut':
        return {
          labels: ['Housing', 'Food', 'Transport', 'Entertainment', 'Healthcare', 'Other'],
          datasets: [{
            label: 'Updated Expenses',
            data: [2000 + Math.random() * 500, 800 + Math.random() * 200, 400 + Math.random() * 100, 300 + Math.random() * 100, 200 + Math.random() * 50, 300 + Math.random() * 100],
            backgroundColor: [
              'rgba(255, 99, 132, 0.8)',
              'rgba(54, 162, 235, 0.8)',
              'rgba(255, 206, 86, 0.8)',
              'rgba(75, 192, 192, 0.8)',
              'rgba(153, 102, 255, 0.8)',
              'rgba(255, 159, 64, 0.8)'
            ]
          }]
        };
      
      default:
        return predefinedCharts.netWorthOverTime;
    }
  };

  const value: DataVisualizationContextType = {
    widgets,
    addWidget,
    removeWidget,
    updateWidget,
    moveWidget,
    resizeWidget,
    refreshWidget,
    refreshAllWidgets,
    exportDashboard,
    importDashboard,
    getWidgetData,
    predefinedCharts
  };

  return React.createElement(
    DataVisualizationContext.Provider,
    { value },
    children
  );
};

export default DataVisualizationContext;
