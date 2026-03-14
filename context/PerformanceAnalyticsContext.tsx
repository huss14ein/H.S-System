import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: Date;
  type: 'navigation' | 'resource' | 'paint' | 'interaction' | 'custom';
  metadata?: Record<string, any>;
}

export interface UserBehavior {
  sessionId: string;
  userId?: string;
  events: BehaviorEvent[];
  startTime: Date;
  endTime?: Date;
  deviceInfo: DeviceInfo;
}

export interface BehaviorEvent {
  type: 'click' | 'scroll' | 'navigation' | 'form_submit' | 'error' | 'custom';
  element?: string;
  timestamp: Date;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface DeviceInfo {
  userAgent: string;
  screenResolution: string;
  viewportSize: string;
  connectionType: string;
  isMobile: boolean;
  memory?: number;
  cores?: number;
}

export interface PerformanceAnalyticsContextType {
  metrics: PerformanceMetric[];
  userBehavior: UserBehavior;
  isTracking: boolean;
  startTracking: () => void;
  stopTracking: () => void;
  recordMetric: (metric: Omit<PerformanceMetric, 'timestamp'>) => void;
  recordEvent: (event: Omit<BehaviorEvent, 'timestamp'>) => void;
  getPerformanceReport: () => PerformanceReport;
  getBehaviorInsights: () => BehaviorInsight[];
  exportData: () => string;
  clearData: () => void;
}

export interface PerformanceReport {
  overview: {
    totalMetrics: number;
    averageLoadTime: number;
    errorRate: number;
    bounceRate: number;
    averageSessionDuration: number;
  };
  webVitals: {
    lcp: number; // Largest Contentful Paint
    fid: number; // First Input Delay
    cls: number; // Cumulative Layout Shift
    fcp: number; // First Contentful Paint
    ttfb: number; // Time to First Byte
  };
  resources: {
    totalRequests: number;
    totalSize: number;
    cachedResources: number;
    slowResources: PerformanceMetric[];
  };
  userExperience: {
    averageInteractionTime: number;
    rageClicks: number;
    deadClicks: number;
    formAbandonment: number;
  };
}

export interface BehaviorInsight {
  type: 'performance' | 'usability' | 'engagement' | 'error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  recommendation: string;
  affectedUsers: number;
  impact: string;
}

const PerformanceAnalyticsContext = createContext<PerformanceAnalyticsContextType | null>(null);

export const usePerformanceAnalytics = () => {
  const context = React.useContext(PerformanceAnalyticsContext);
  if (!context) {
    throw new Error('usePerformanceAnalytics must be used within a PerformanceAnalyticsProvider');
  }
  return context;
};

interface PerformanceAnalyticsProviderProps {
  children: ReactNode;
  apiKey?: string;
  enableAutoTracking?: boolean;
}

export const PerformanceAnalyticsProvider: React.FC<PerformanceAnalyticsProviderProps> = ({
  children,
  apiKey,
  enableAutoTracking = true
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [userBehavior, setUserBehavior] = useState<UserBehavior | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  // Initialize session
  useEffect(() => {
    if (enableAutoTracking) {
      initializeSession();
      startTracking();
    }

    return () => {
      if (isTracking) {
        stopTracking();
      }
    };
  }, []);

  const initializeSession = () => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const deviceInfo = collectDeviceInfo();

    setUserBehavior({
      sessionId,
      events: [],
      startTime: new Date(),
      deviceInfo
    });
  };

  const collectDeviceInfo = (): DeviceInfo => {
    return {
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      connectionType: (navigator as any).connection?.effectiveType || 'unknown',
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      memory: (performance as any).memory?.totalJSHeapSize,
      cores: navigator.hardwareConcurrency
    };
  };

  const startTracking = () => {
    setIsTracking(true);
    
    // Track Web Vitals
    trackWebVitals();
    
    // Track resource loading
    trackResourceTiming();
    
    // Track user interactions
    trackUserInteractions();
    
    // Track navigation
    trackNavigation();
    
    // Track errors
    trackErrors();
  };

  const stopTracking = () => {
    setIsTracking(false);
    
    if (userBehavior) {
      setUserBehavior(prev => prev ? { ...prev, endTime: new Date() } : null);
    }
  };

  const trackWebVitals = () => {
    // Largest Contentful Paint (LCP)
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      recordMetric({
        name: 'LCP',
        value: lastEntry.startTime,
        type: 'paint',
        metadata: { element: lastEntry.element?.tagName }
      });
    }).observe({ entryTypes: ['largest-contentful-paint'] });

    // First Input Delay (FID)
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry: any) => {
        recordMetric({
          name: 'FID',
          value: entry.processingStart - entry.startTime,
          type: 'interaction',
          metadata: { inputType: entry.name }
        });
      });
    }).observe({ entryTypes: ['first-input'] });

    // Cumulative Layout Shift (CLS)
    let clsValue = 0;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry: any) => {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
          recordMetric({
            name: 'CLS',
            value: clsValue,
            type: 'custom'
          });
        }
      });
    }).observe({ entryTypes: ['layout-shift'] });

    // First Contentful Paint (FCP)
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const fcpEntry = entries.find(entry => entry.name === 'first-contentful-paint');
      if (fcpEntry) {
        recordMetric({
          name: 'FCP',
          value: fcpEntry.startTime,
          type: 'paint'
        });
      }
    }).observe({ entryTypes: ['paint'] });
  };

  const trackResourceTiming = () => {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry: any) => {
        const loadTime = entry.responseEnd - entry.requestStart;
        recordMetric({
          name: 'Resource Load',
          value: loadTime,
          type: 'resource',
          metadata: {
            name: entry.name,
            type: entry.initiatorType,
            size: entry.transferSize,
            cached: entry.transferSize === 0
          }
        });
      });
    });
    observer.observe({ entryTypes: ['resource'] });
  };

  const trackUserInteractions = () => {
    // Track clicks
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      recordEvent({
        type: 'click',
        element: target.tagName + (target.className ? `.${target.className}` : ''),
        metadata: {
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now()
        }
      });
    });

    // Track scrolls
    let scrollTimeout: NodeJS.Timeout;
    document.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        recordEvent({
          type: 'scroll',
          metadata: {
            scrollY: window.scrollY,
            scrollX: window.scrollX,
            scrollPercentage: (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
          }
        });
      }, 100);
    }, { passive: true });

    // Track form interactions
    document.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement;
      recordEvent({
        type: 'form_submit',
        element: form.tagName,
        metadata: {
          formId: form.id,
          formName: form.name,
          fields: form.elements.length
        }
      });
    });
  };

  const trackNavigation = () => {
    // Track page navigation
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry: any) => {
        recordMetric({
          name: 'Navigation',
          value: entry.loadEventEnd - entry.loadEventStart,
          type: 'navigation',
          metadata: {
            type: entry.type,
            redirectCount: entry.redirectCount,
            transferSize: entry.transferSize
          }
        });
      });
    });
    observer.observe({ entryTypes: ['navigation'] });
  };

  const trackErrors = () => {
    // Track JavaScript errors
    window.addEventListener('error', (event) => {
      recordEvent({
        type: 'error',
        metadata: {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack
        }
      });
    });

    // Track promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      recordEvent({
        type: 'error',
        metadata: {
          message: event.reason?.message || 'Unhandled Promise Rejection',
          stack: event.reason?.stack
        }
      });
    });
  };

  const recordMetric = (metric: Omit<PerformanceMetric, 'timestamp'>) => {
    const fullMetric: PerformanceMetric = {
      ...metric,
      timestamp: new Date()
    };

    setMetrics(prev => [...prev, fullMetric]);

    // Send to analytics service if API key is provided
    if (apiKey) {
      sendToAnalytics(fullMetric);
    }
  };

  const recordEvent = (event: Omit<BehaviorEvent, 'timestamp'>) => {
    if (!userBehavior) return;

    const fullEvent: BehaviorEvent = {
      ...event,
      timestamp: new Date()
    };

    setUserBehavior(prev => prev ? {
      ...prev,
      events: [...prev.events, fullEvent]
    } : null);
  };

  const sendToAnalytics = async (metric: PerformanceMetric) => {
    try {
      await fetch('/api/analytics/metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(metric)
      });
    } catch (error) {
      console.error('Failed to send metric to analytics:', error);
    }
  };

  const getPerformanceReport = (): PerformanceReport => {
    const navigationMetrics = metrics.filter(m => m.type === 'navigation');
    const resourceMetrics = metrics.filter(m => m.type === 'resource');
    const paintMetrics = metrics.filter(m => m.type === 'paint');
    const interactionMetrics = metrics.filter(m => m.type === 'interaction');

    const lcp = paintMetrics.find(m => m.name === 'LCP')?.value || 0;
    const fid = interactionMetrics.find(m => m.name === 'FID')?.value || 0;
    const cls = paintMetrics.find(m => m.name === 'CLS')?.value || 0;
    const fcp = paintMetrics.find(m => m.name === 'FCP')?.value || 0;
    const ttfb = navigationMetrics[0]?.metadata?.responseStart || 0;

    const slowResources = resourceMetrics.filter(m => m.value > 2000);
    const cachedResources = resourceMetrics.filter(m => m.metadata?.cached).length;

    return {
      overview: {
        totalMetrics: metrics.length,
        averageLoadTime: navigationMetrics.reduce((sum, m) => sum + m.value, 0) / navigationMetrics.length || 0,
        errorRate: (userBehavior?.events.filter(e => e.type === 'error').length || 0) / (userBehavior?.events.length || 1) * 100,
        bounceRate: calculateBounceRate(),
        averageSessionDuration: calculateAverageSessionDuration()
      },
      webVitals: { lcp, fid, cls, fcp, ttfb },
      resources: {
        totalRequests: resourceMetrics.length,
        totalSize: resourceMetrics.reduce((sum, m) => sum + (m.metadata?.size || 0), 0),
        cachedResources,
        slowResources
      },
      userExperience: {
        averageInteractionTime: calculateAverageInteractionTime(),
        rageClicks: countRageClicks(),
        deadClicks: countDeadClicks(),
        formAbandonment: calculateFormAbandonment()
      }
    };
  };

  const getBehaviorInsights = (): BehaviorInsight[] => {
    const insights: BehaviorInsight[] = [];
    const report = getPerformanceReport();

    // Performance insights
    if (report.webVitals.lcp > 2500) {
      insights.push({
        type: 'performance',
        severity: report.webVitals.lcp > 4000 ? 'critical' : 'high',
        title: 'Slow Largest Contentful Paint',
        description: `LCP is ${report.webVitals.lcp}ms, which is slower than recommended`,
        recommendation: 'Optimize images, reduce server response time, and eliminate render-blocking resources',
        affectedUsers: 100,
        impact: 'Poor user experience and lower conversion rates'
      });
    }

    if (report.webVitals.fid > 100) {
      insights.push({
        type: 'performance',
        severity: report.webVitals.fid > 300 ? 'critical' : 'high',
        title: 'High First Input Delay',
        description: `FID is ${report.webVitals.fid}ms, indicating slow interactivity`,
        recommendation: 'Reduce JavaScript execution time and break up long tasks',
        affectedUsers: 100,
        impact: 'Frustrating user experience with delayed responses'
      });
    }

    // Usability insights
    if (report.userExperience.rageClicks > 5) {
      insights.push({
        type: 'usability',
        severity: 'medium',
        title: 'High Rage Click Activity',
        description: `Users are clicking multiple times on the same elements`,
        recommendation: 'Improve button responsiveness and add loading states',
        affectedUsers: 25,
        impact: 'User frustration and potential abandonment'
      });
    }

    // Engagement insights
    if (report.overview.bounceRate > 70) {
      insights.push({
        type: 'engagement',
        severity: 'high',
        title: 'High Bounce Rate',
        description: `Bounce rate is ${report.overview.bounceRate.toFixed(1)}%`,
        recommendation: 'Improve page load speed and content relevance',
        affectedUsers: 70,
        impact: 'Low engagement and poor conversion'
      });
    }

    return insights;
  };

  const calculateBounceRate = (): number => {
    // Simplified bounce rate calculation
    const singlePageSessions = 1; // This would come from actual analytics
    const totalSessions = 1;
    return (singlePageSessions / totalSessions) * 100;
  };

  const calculateAverageSessionDuration = (): number => {
    if (!userBehavior) return 0;
    const endTime = userBehavior.endTime || new Date();
    return endTime.getTime() - userBehavior.startTime.getTime();
  };

  const calculateAverageInteractionTime = (): number => {
    const interactionEvents = userBehavior?.events.filter(e => e.type === 'click') || [];
    return interactionEvents.length;
  };

  const countRageClicks = (): number => {
    const clickEvents = userBehavior?.events.filter(e => e.type === 'click') || [];
    let rageClicks = 0;
    
    // Group clicks by element and time
    const clicksByElement: Record<string, number[]> = {};
    clickEvents.forEach(click => {
      const key = click.element || 'unknown';
      if (!clicksByElement[key]) clicksByElement[key] = [];
      clicksByElement[key].push(click.timestamp.getTime());
    });

    // Count rapid clicks on same element
    Object.values(clicksByElement).forEach(timestamps => {
      for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] - timestamps[i-1] < 500) {
          rageClicks++;
        }
      }
    });

    return rageClicks;
  };

  const countDeadClicks = (): number => {
    // Simplified dead click detection
    return 0;
  };

  const calculateFormAbandonment = (): number => {
    const formEvents = userBehavior?.events.filter(e => e.type === 'form_submit') || [];
    const formStartEvents = userBehavior?.events.filter(e => e.metadata?.formStart) || [];
    
    if (formStartEvents.length === 0) return 0;
    return ((formStartEvents.length - formEvents.length) / formStartEvents.length) * 100;
  };

  const exportData = (): string => {
    const data = {
      metrics,
      userBehavior,
      report: getPerformanceReport(),
      insights: getBehaviorInsights(),
      exportDate: new Date().toISOString()
    };
    
    return JSON.stringify(data, null, 2);
  };

  const clearData = () => {
    setMetrics([]);
    initializeSession();
  };

  const value: PerformanceAnalyticsContextType = {
    metrics,
    userBehavior: userBehavior!,
    isTracking,
    startTracking,
    stopTracking,
    recordMetric,
    recordEvent,
    getPerformanceReport,
    getBehaviorInsights,
    exportData,
    clearData
  };

  return React.createElement(
    PerformanceAnalyticsContext.Provider,
    { value },
    children
  );
};

export default PerformanceAnalyticsContext;
