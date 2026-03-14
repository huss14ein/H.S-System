import React from 'react';
import { usePerformanceAnalytics } from '../context/PerformanceAnalyticsContext';

interface PerformanceMonitorProps {
  className?: string;
  showDetails?: boolean;
}

const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({ 
  className = '', 
  showDetails = false 
}) => {
  const { 
    metrics, 
    userBehavior, 
    isTracking, 
    getPerformanceReport, 
    getBehaviorInsights,
    startTracking,
    stopTracking 
  } = usePerformanceAnalytics();

  const report = getPerformanceReport();
  const insights = getBehaviorInsights();

  const getWebVitalsColor = (value: number, threshold: { good: number; poor: number }) => {
    if (value <= threshold.good) return 'text-green-600';
    if (value <= threshold.poor) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (!showDetails) {
    return React.createElement(
      'div',
      { className: `fixed bottom-4 right-4 bg-black bg-opacity-75 text-white p-3 rounded-lg text-xs font-mono ${className}` },
      [
        React.createElement(
          'div',
          { key: 'status' },
          `Tracking: ${isTracking ? 'ON' : 'OFF'}`
        ),
        React.createElement(
          'div',
          { key: 'metrics' },
          `Metrics: ${metrics.length}`
        ),
        React.createElement(
          'div',
          { key: 'events' },
          `Events: ${userBehavior?.events.length || 0}`
        ),
        React.createElement(
          'div',
          { key: 'lcp' },
          `LCP: ${report.webVitals.lcp.toFixed(0)}ms`
        )
      ]
    );
  }

  return React.createElement(
    'div',
    { className: `fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 ${className}` },
    React.createElement(
      'div',
      { className: 'bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto' },
      [
        // Header
        React.createElement(
          'div',
          { key: 'header', className: 'p-6 border-b border-gray-200 dark:border-gray-700' },
          [
            React.createElement(
              'h2',
              { key: 'title', className: 'text-2xl font-bold text-gray-900 dark:text-white' },
              'Performance Analytics Dashboard'
            ),
            React.createElement(
              'div',
              { key: 'controls', className: 'flex items-center space-x-4 mt-4' },
              [
                React.createElement(
                  'button',
                  {
                    key: 'toggle',
                    onClick: isTracking ? stopTracking : startTracking,
                    className: `px-4 py-2 rounded-lg font-medium ${
                      isTracking 
                        ? 'bg-red-600 text-white hover:bg-red-700' 
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`
                  },
                  isTracking ? 'Stop Tracking' : 'Start Tracking'
                ),
                React.createElement(
                  'span',
                  { key: 'status', className: 'text-sm text-gray-600 dark:text-gray-400' },
                  `Status: ${isTracking ? 'Tracking' : 'Stopped'}`
                )
              ]
            )
          ]
        ),

        // Overview Section
        React.createElement(
          'div',
          { key: 'overview', className: 'p-6 border-b border-gray-200 dark:border-gray-700' },
          [
            React.createElement(
              'h3',
              { key: 'title', className: 'text-lg font-semibold text-gray-900 dark:text-white mb-4' },
              'Overview'
            ),
            React.createElement(
              'div',
              { key: 'stats', className: 'grid grid-cols-2 md:grid-cols-4 gap-4' },
              [
                React.createElement(
                  'div',
                  { key: 'metrics', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'Total Metrics'),
                    React.createElement('div', { key: 'value', className: 'text-2xl font-bold text-gray-900 dark:text-white' }, report.overview.totalMetrics)
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'loadTime', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'Avg Load Time'),
                    React.createElement('div', { key: 'value', className: 'text-2xl font-bold text-gray-900 dark:text-white' }, `${report.overview.averageLoadTime.toFixed(0)}ms`)
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'errorRate', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'Error Rate'),
                    React.createElement('div', { key: 'value', className: 'text-2xl font-bold text-gray-900 dark:text-white' }, `${report.overview.errorRate.toFixed(1)}%`)
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'bounceRate', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'Bounce Rate'),
                    React.createElement('div', { key: 'value', className: 'text-2xl font-bold text-gray-900 dark:text-white' }, `${report.overview.bounceRate.toFixed(1)}%`)
                  ]
                )
              ]
            )
          ]
        ),

        // Web Vitals Section
        React.createElement(
          'div',
          { key: 'webVitals', className: 'p-6 border-b border-gray-200 dark:border-gray-700' },
          [
            React.createElement(
              'h3',
              { key: 'title', className: 'text-lg font-semibold text-gray-900 dark:text-white mb-4' },
              'Core Web Vitals'
            ),
            React.createElement(
              'div',
              { key: 'vitals', className: 'grid grid-cols-2 md:grid-cols-5 gap-4' },
              [
                React.createElement(
                  'div',
                  { key: 'lcp', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'LCP'),
                    React.createElement(
                      'div', 
                      { key: 'value', className: `text-xl font-bold ${getWebVitalsColor(report.webVitals.lcp, { good: 2500, poor: 4000 })}` },
                      `${report.webVitals.lcp.toFixed(0)}ms`
                    )
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'fid', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'FID'),
                    React.createElement(
                      'div', 
                      { key: 'value', className: `text-xl font-bold ${getWebVitalsColor(report.webVitals.fid, { good: 100, poor: 300 })}` },
                      `${report.webVitals.fid.toFixed(0)}ms`
                    )
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'cls', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'CLS'),
                    React.createElement(
                      'div', 
                      { key: 'value', className: `text-xl font-bold ${getWebVitalsColor(report.webVitals.cls, { good: 0.1, poor: 0.25 })}` },
                      report.webVitals.cls.toFixed(3)
                    )
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'fcp', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'FCP'),
                    React.createElement(
                      'div', 
                      { key: 'value', className: `text-xl font-bold ${getWebVitalsColor(report.webVitals.fcp, { good: 1800, poor: 3000 })}` },
                      `${report.webVitals.fcp.toFixed(0)}ms`
                    )
                  ]
                ),
                React.createElement(
                  'div',
                  { key: 'ttfb', className: 'bg-gray-50 dark:bg-gray-700 p-4 rounded-lg' },
                  [
                    React.createElement('div', { key: 'label', className: 'text-sm text-gray-600 dark:text-gray-400' }, 'TTFB'),
                    React.createElement(
                      'div', 
                      { key: 'value', className: `text-xl font-bold ${getWebVitalsColor(report.webVitals.ttfb, { good: 800, poor: 1800 })}` },
                      `${report.webVitals.ttfb.toFixed(0)}ms`
                    )
                  ]
                )
              ]
            )
          ]
        ),

        // Insights Section
        React.createElement(
          'div',
          { key: 'insights', className: 'p-6' },
          [
            React.createElement(
              'h3',
              { key: 'title', className: 'text-lg font-semibold text-gray-900 dark:text-white mb-4' },
              'Performance Insights'
            ),
            insights.length === 0 
              ? React.createElement(
                  'p',
                  { key: 'no-insights', className: 'text-gray-600 dark:text-gray-400' },
                  'No performance issues detected. Great job!'
                )
              : React.createElement(
                  'div',
                  { key: 'insights-list', className: 'space-y-3' },
                  insights.map((insight, index) =>
                    React.createElement(
                      'div',
                      { key: index, className: `p-4 rounded-lg border ${getSeverityColor(insight.severity)}` },
                      [
                        React.createElement(
                          'div',
                          { key: 'header', className: 'flex items-start justify-between' },
                          [
                            React.createElement(
                              'h4',
                              { key: 'title', className: 'font-semibold' },
                              insight.title
                            ),
                            React.createElement(
                              'span',
                              { key: 'severity', className: 'text-xs px-2 py-1 rounded-full bg-white bg-opacity-50' },
                              insight.severity.toUpperCase()
                            )
                          ]
                        ),
                        React.createElement(
                          'p',
                          { key: 'description', className: 'text-sm mt-2' },
                          insight.description
                        ),
                        React.createElement(
                          'div',
                          { key: 'recommendation', className: 'mt-3' },
                          [
                            React.createElement('span', { key: 'label', className: 'text-xs font-semibold' }, 'Recommendation: '),
                            React.createElement('span', { key: 'text', className: 'text-xs' }, insight.recommendation)
                          ]
                        )
                      ]
                    )
                  )
                )
          ]
        )
      ]
    )
  );
};

export default PerformanceMonitor;
