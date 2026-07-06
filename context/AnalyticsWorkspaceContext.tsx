import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ExpenseAnalysisScope } from '../services/expenseBudgetAnalysisModel';

export type AnalyticsPeriodPreset = 'MTD' | '3M' | '6M' | '12M' | 'YTD';

type AnalyticsWorkspaceState = {
  periodPreset: AnalyticsPeriodPreset;
  scope: ExpenseAnalysisScope;
  selectedCategory: string | null;
  selectedMonthKey: string | null;
  wealthZone: 'overview' | 'wealth' | 'investments' | 'cash';
  analysisExplorerTab: 'categories' | 'merchants' | 'cashflow' | 'position' | 'refunds';
};

type AnalyticsWorkspaceContextValue = AnalyticsWorkspaceState & {
  setPeriodPreset: (p: AnalyticsPeriodPreset) => void;
  setScope: (s: ExpenseAnalysisScope) => void;
  setSelectedCategory: (c: string | null) => void;
  setSelectedMonthKey: (k: string | null) => void;
  setWealthZone: (z: AnalyticsWorkspaceState['wealthZone']) => void;
  setAnalysisExplorerTab: (t: AnalyticsWorkspaceState['analysisExplorerTab']) => void;
};

const STORAGE_KEY = 'finova_analytics_workspace_v1';

function loadInitial(): AnalyticsWorkspaceState {
  const defaults: AnalyticsWorkspaceState = {
    periodPreset: 'MTD',
    scope: 'personal',
    selectedCategory: null,
    selectedMonthKey: null,
    wealthZone: 'overview',
    analysisExplorerTab: 'categories',
  };
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

const AnalyticsWorkspaceContext = createContext<AnalyticsWorkspaceContextValue | null>(null);

export const AnalyticsWorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AnalyticsWorkspaceState>(loadInitial);

  const persist = useCallback((next: AnalyticsWorkspaceState) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<AnalyticsWorkspaceContextValue>(
    () => ({
      ...state,
      setPeriodPreset: (periodPreset) => persist({ ...state, periodPreset }),
      setScope: (scope) => persist({ ...state, scope }),
      setSelectedCategory: (selectedCategory) => persist({ ...state, selectedCategory }),
      setSelectedMonthKey: (selectedMonthKey) => persist({ ...state, selectedMonthKey }),
      setWealthZone: (wealthZone) => persist({ ...state, wealthZone }),
      setAnalysisExplorerTab: (analysisExplorerTab) => persist({ ...state, analysisExplorerTab }),
    }),
    [state, persist],
  );

  return <AnalyticsWorkspaceContext.Provider value={value}>{children}</AnalyticsWorkspaceContext.Provider>;
};

export function useAnalyticsWorkspace(): AnalyticsWorkspaceContextValue {
  const ctx = useContext(AnalyticsWorkspaceContext);
  if (!ctx) {
    throw new Error('useAnalyticsWorkspace requires AnalyticsWorkspaceProvider');
  }
  return ctx;
}

export function useAnalyticsWorkspaceOptional(): AnalyticsWorkspaceContextValue | null {
  return useContext(AnalyticsWorkspaceContext);
}
