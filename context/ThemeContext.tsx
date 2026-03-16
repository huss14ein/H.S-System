import React, { createContext, useState, useEffect, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'high-contrast';

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  systemTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const useTheme = (): ThemeContextType => {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Default to light theme for all pages. Only use stored preference if user explicitly chose one.
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme;
      if (stored && ['light', 'dark', 'high-contrast'].includes(stored)) {
        return stored;
      }
    }
    return 'light';
  });

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

  // Detect system theme changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = (e: MediaQueryListEvent) => {
        setSystemTheme(e.matches ? 'dark' : 'light');
      };

      // Set initial system theme
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

      // Listen for changes
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else {
        // Fallback for older browsers
        mediaQuery.addListener(handleChange);
      }

      return () => {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handleChange);
        } else {
          mediaQuery.removeListener(handleChange);
        }
      };
    }
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      
      // Remove all theme classes
      root.classList.remove('light', 'dark', 'high-contrast');
      
      // Add current theme class
      root.classList.add(theme);
      
      // Store preference
      localStorage.setItem('theme', theme);
      
      // Update meta theme-color for mobile browsers
      const themeColor = theme === 'dark' ? '#1f2937' : theme === 'high-contrast' ? '#000000' : '#ffffff';
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', themeColor);
      }
    }
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prevTheme: Theme) => {
      switch (prevTheme) {
        case 'light':
          return 'dark';
        case 'dark':
          return 'high-contrast';
        case 'high-contrast':
          return 'light';
        default:
          return 'light';
      }
    });
  };

  const value: ThemeContextType = {
    theme,
    setTheme,
    toggleTheme,
    systemTheme
  };

  return React.createElement(
    ThemeContext.Provider,
    { value },
    children
  );
};

export default ThemeContext;
