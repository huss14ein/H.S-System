import React, { useState, useEffect } from 'react';
import { useWidgets } from '../context/WidgetContext';

interface HomeScreenWidgetProps {
  widget: {
    id: string;
    type: 'balance' | 'budget' | 'goals' | 'investments' | 'transactions' | 'savings';
    title: string;
    size: 'small' | 'medium' | 'large';
    config?: Record<string, any>;
  };
  onEdit?: () => void;
  onRemove?: () => void;
}

const HomeScreenWidget: React.FC<HomeScreenWidgetProps> = ({ widget, onEdit, onRemove }) => {
  const { getWidgetData, refreshWidget } = useWidgets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWidgetData();
  }, [widget.type]);

  const loadWidgetData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const widgetData = await getWidgetData(widget.type);
      setData(widgetData);
    } catch (err) {
      setError('Failed to load widget data');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await refreshWidget(widget.id);
    await loadWidgetData();
  };

  const getSizeClasses = () => {
    switch (widget.size) {
      case 'small':
        return 'col-span-1 row-span-1';
      case 'medium':
        return 'col-span-2 row-span-1';
      case 'large':
        return 'col-span-2 row-span-2';
      default:
        return 'col-span-1 row-span-1';
    }
  };

  const renderWidgetContent = () => {
    if (loading) {
      return React.createElement(
        'div',
        { className: 'flex items-center justify-center h-full' },
        React.createElement('div', { className: 'w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin' })
      );
    }

    if (error) {
      return React.createElement(
        'div',
        { className: 'flex flex-col items-center justify-center h-full text-center' },
        [
          React.createElement('div', { key: 'icon', className: 'text-red-500 text-2xl mb-2' }, '⚠️'),
          React.createElement('p', { key: 'error', className: 'text-sm text-gray-600 dark:text-gray-400' }, error),
          React.createElement(
            'button',
            {
              key: 'retry',
              onClick: handleRefresh,
              className: 'mt-2 text-xs text-blue-600 hover:text-blue-700'
            },
            'Retry'
          )
        ]
      );
    }

    switch (widget.type) {
      case 'balance':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 dark:text-white' }, 'Balance')
            ),
            React.createElement(
              'div',
              { key: 'content' },
              [
                React.createElement(
                  'p',
                  { key: 'amount', className: 'text-2xl font-bold text-blue-600 dark:text-blue-400' },
                  `$${data.totalBalance.toLocaleString()}`
                ),
                React.createElement(
                  'p',
                  { key: 'change', className: 'text-sm text-green-600 dark:text-green-400' },
                  `+${data.change}% today`
                )
              ]
            )
          ]
        );

      case 'budget':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-sm font-semibold text-gray-900 dark:text-white' }, 'Budget')
            ),
            React.createElement(
              'div',
              { key: 'content' },
              [
                React.createElement(
                  'div',
                  { key: 'progress', className: 'mb-2' },
                  React.createElement(
                    'div',
                    { className: 'w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2' },
                    React.createElement(
                      'div',
                      {
                        className: 'bg-blue-600 h-2 rounded-full',
                        style: { width: `${data.percentage}%` }
                      }
                    )
                  )
                ),
                React.createElement(
                  'p',
                  { key: 'remaining', className: 'text-xs text-gray-600 dark:text-gray-400' },
                  `$${data.remaining} left`
                )
              ]
            )
          ]
        );

      case 'goals':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 dark:text-white' }, 'Goals')
            ),
            React.createElement(
              'div',
              { key: 'content', className: 'space-y-2' },
              (data?.goals ?? []).slice(0, 3).map((goal: any, index: number) =>
                React.createElement(
                  'div',
                  { key: index, className: 'flex justify-between items-center' },
                  [
                    React.createElement(
                      'span',
                      { key: 'name', className: 'text-sm text-gray-700 dark:text-gray-300' },
                      goal.name
                    ),
                    React.createElement(
                      'span',
                      { key: 'percentage', className: 'text-xs font-medium text-blue-600 dark:text-blue-400' },
                      `${goal?.percentage ?? 0}%`
                    )
                  ]
                )
              )
            )
          ]
        );

      case 'investments':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 dark:text-white' }, 'Investments')
            ),
            React.createElement(
              'div',
              { key: 'content' },
              [
                React.createElement(
                  'p',
                  { key: 'value', className: 'text-xl font-bold text-green-600 dark:text-green-400' },
                  `$${data.totalValue.toLocaleString()}`
                ),
                React.createElement(
                  'p',
                  { key: 'change', className: 'text-sm text-green-600 dark:text-green-400' },
                  `+${data.dayChangePercentage}% today`
                )
              ]
            )
          ]
        );

      case 'transactions':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-sm font-semibold text-gray-900 dark:text-white' }, 'Today')
            ),
            React.createElement(
              'div',
              { key: 'content', className: 'space-y-1' },
              data.recentTransactions.slice(0, 3).map((transaction: any, index: number) =>
                React.createElement(
                  'div',
                  { key: index, className: 'flex justify-between items-center text-xs' },
                  [
                    React.createElement(
                      'span',
                      { key: 'name', className: 'text-gray-700 dark:text-gray-300' },
                      transaction.name
                    ),
                    React.createElement(
                      'span',
                      { key: 'amount', className: 'font-medium text-gray-900 dark:text-white' },
                      `$${transaction.amount}`
                    )
                  ]
                )
              )
            )
          ]
        );

      case 'savings':
        return React.createElement(
          'div',
          { className: 'h-full flex flex-col justify-between' },
          [
            React.createElement(
              'div',
              { key: 'header' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 dark:text-white' }, 'Savings')
            ),
            React.createElement(
              'div',
              { key: 'content' },
              [
                React.createElement(
                  'p',
                  { key: 'total', className: 'text-xl font-bold text-green-600 dark:text-green-400' },
                  `$${data.totalSavings.toLocaleString()}`
                ),
                React.createElement(
                  'p',
                  { key: 'rate', className: 'text-sm text-gray-600 dark:text-gray-400' },
                  `${data.savingsRate}% savings rate`
                )
              ]
            )
          ]
        );

      default:
        return React.createElement(
          'div',
          { className: 'flex items-center justify-center h-full' },
          React.createElement('p', { className: 'text-gray-500' }, 'Unknown widget type')
        );
    }
  };

  return React.createElement(
    'div',
    {
      className: `
        ${getSizeClasses()}
        bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-gray-700
        hover:shadow-md transition-shadow duration-200 relative group
      `
    },
    [
      // Widget content
      React.createElement('div', { key: 'content' }, renderWidgetContent()),
      
      // Widget controls
      React.createElement(
        'div',
        {
          key: 'controls',
          className: 'absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex space-x-1'
        },
        [
          React.createElement(
            'button',
            {
              key: 'refresh',
              onClick: handleRefresh,
              className: 'p-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600',
              title: 'Refresh widget'
            },
            React.createElement(
              'svg',
              { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: 2,
                d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
              })
            )
          ),
          onEdit && React.createElement(
            'button',
            {
              key: 'edit',
              onClick: onEdit,
              className: 'p-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600',
              title: 'Edit widget'
            },
            React.createElement(
              'svg',
              { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: 2,
                d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
              })
            )
          ),
          onRemove && React.createElement(
            'button',
            {
              key: 'remove',
              onClick: onRemove,
              className: 'p-1 rounded-lg bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800',
              title: 'Remove widget'
            },
            React.createElement(
              'svg',
              { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
              React.createElement('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: 2,
                d: 'M6 18L18 6M6 6l12 12'
              })
            )
          )
        ]
      )
    ]
  );
};

export default HomeScreenWidget;
