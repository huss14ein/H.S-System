import React from 'react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646 9 9 0 00-8.354 5.646zM12 3v.01M12 19v.01M8 12h.01M16 12h.01' })
        );
      case 'dark':
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' })
        );
      case 'high-contrast':
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          [
            React.createElement('path', { key: '1', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' }),
            React.createElement('path', { key: '2', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' })
          ]
        );
      default:
        return null;
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light Mode';
      case 'dark':
        return 'Dark Mode';
      case 'high-contrast':
        return 'High Contrast';
      default:
        return 'Light Mode';
    }
  };

  return React.createElement(
    'button',
    {
      onClick: toggleTheme,
      className: `p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 group ${className}`,
      title: `Current: ${getThemeLabel()}. Click to cycle themes.`,
      'aria-label': `Toggle theme. Current theme: ${getThemeLabel()}`
    },
    React.createElement(
      'div',
      { className: 'relative' },
      React.createElement(
        'div',
        { className: 'transform transition-transform duration-300 group-hover:scale-110' },
        getThemeIcon()
      ),
      
      // Theme indicator dots
      React.createElement(
        'div',
        { className: 'absolute -bottom-1 -right-1 flex space-x-0.5' },
        React.createElement('div', {
          className: `w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            theme === 'light' ? 'bg-yellow-500' : 'bg-gray-300'
          }`
        }),
        React.createElement('div', {
          className: `w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            theme === 'dark' ? 'bg-blue-500' : 'bg-gray-300'
          }`
        }),
        React.createElement('div', {
          className: `w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            theme === 'high-contrast' ? 'bg-purple-500' : 'bg-gray-300'
          }`
        })
      )
    )
  );
};

export default ThemeToggle;
