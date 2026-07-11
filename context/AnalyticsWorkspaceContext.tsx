import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ExpenseAnalysisScope } from '../services/expenseBudgetAnalysisModel';

export type AnalyticsPeriodPreset = 'MTD' | '3M' | '6M' | '12M' | 'YTD';

type AnalyticsWorkspaceState = {
  periodPreset: AnalyticsPeriodPreset;
  scope: ExpenseAnalysisScope;
  selectedCategory: string | null;
  selectedMonthKey: string | null;
  wealthZone: 'overview' | 'wealth' | 'investments' | 'cash';
  analysisExplorerTab: 'categories' | 'merchants' | 'cashflow' | 'refunds';
  analysisStudioTab: 'explore' | 'command' | 'position';
};

type AnalyticsWorkspaceContextValue = AnalyticsWorkspaceState & {
  setPeriodPreset: (p: AnalyticsPeriodPreset) => void;
  setScope: (s: ExpenseAnalysisScope) => void;
  setSelectedCategory: (c: string | null) => void;
  setSelectedMonthKey: (k: string | null) => void;
  setWealthZone: (z: AnalyticsWorkspaceState['wealthZone']) => void;
  setAnalysisExplorerTab: (t: AnalyticsWorkspaceState['analysisExplorerTab']) => void;
  setAnalysisStudioTab: (t: AnalyticsWorkspaceState['analysisStudioTab']) => void;
};

const STORAGE_KEY = 'finova_analytics_workspace_v1';
const URL_PARAM = 'aw';
const URL_DEBOUNCE_MS = 300;

const PERIOD_PRESETS: AnalyticsPeriodPreset[] = ['MTD', '3M', '6M', '12M', 'YTD'];
const SCOPES: ExpenseAnalysisScope[] = ['personal', 'household'];
const WEALTH_ZONES: AnalyticsWorkspaceState['wealthZone'][] = ['overview', 'wealth', 'investments', 'cash'];
const EXPLORER_TABS: AnalyticsWorkspaceState['analysisExplorerTab'][] = [
  'categories',
  'merchants',
  'cashflow',
  'refunds',
];
const STUDIO_TABS: AnalyticsWorkspaceState['analysisStudioTab'][] = ['explore', 'command', 'position'];

const DEFAULTS: AnalyticsWorkspaceState = {
  periodPreset: 'MTD',
  scope: 'personal',
  selectedCategory: null,
  selectedMonthKey: null,
  wealthZone: 'overview',
  analysisExplorerTab: 'categories',
  analysisStudioTab: 'explore',
};

function loadInitial(): AnalyticsWorkspaceState {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function parseAwParam(raw: string | null): Partial<AnalyticsWorkspaceState> {
  if (!raw) return {};
  const out: Partial<AnalyticsWorkspaceState> = {};
  for (const segment of raw.split(';')) {
    const idx = segment.indexOf(':');
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim();
    const value = decodeURIComponent(segment.slice(idx + 1).trim());
    if (key === 'period' && PERIOD_PRESETS.includes(value as AnalyticsPeriodPreset)) {
      out.periodPreset = value as AnalyticsPeriodPreset;
    } else if (key === 'scope' && SCOPES.includes(value as ExpenseAnalysisScope)) {
      out.scope = value as ExpenseAnalysisScope;
    } else if (key === 'zone' && WEALTH_ZONES.includes(value as AnalyticsWorkspaceState['wealthZone'])) {
      out.wealthZone = value as AnalyticsWorkspaceState['wealthZone'];
    } else if (key === 'tab' && EXPLORER_TABS.includes(value as AnalyticsWorkspaceState['analysisExplorerTab'])) {
      out.analysisExplorerTab = value as AnalyticsWorkspaceState['analysisExplorerTab'];
    } else if (key === 'studio' && STUDIO_TABS.includes(value as AnalyticsWorkspaceState['analysisStudioTab'])) {
      out.analysisStudioTab = value as AnalyticsWorkspaceState['analysisStudioTab'];
    } else if (key === 'cat' && value) {
      out.selectedCategory = value;
    } else if (key === 'month' && value) {
      out.selectedMonthKey = value;
    }
  }
  return out;
}

function serializeAwParam(state: AnalyticsWorkspaceState): string {
  const parts: string[] = [];
  if (state.periodPreset !== DEFAULTS.periodPreset) parts.push(`period:${state.periodPreset}`);
  if (state.scope !== DEFAULTS.scope) parts.push(`scope:${state.scope}`);
  if (state.wealthZone !== DEFAULTS.wealthZone) parts.push(`zone:${state.wealthZone}`);
  if (state.analysisExplorerTab !== DEFAULTS.analysisExplorerTab) parts.push(`tab:${state.analysisExplorerTab}`);
  if (state.analysisStudioTab !== DEFAULTS.analysisStudioTab) parts.push(`studio:${state.analysisStudioTab}`);
  if (state.selectedCategory) parts.push(`cat:${encodeURIComponent(state.selectedCategory)}`);
  if (state.selectedMonthKey) parts.push(`month:${encodeURIComponent(state.selectedMonthKey)}`);
  return parts.join(';');
}

function readUrlOverrides(): Partial<AnalyticsWorkspaceState> {
  if (typeof window === 'undefined') return {};
  try {
    return parseAwParam(new URLSearchParams(window.location.search).get(URL_PARAM));
  } catch {
    return {};
  }
}

function writeUrlFromState(state: AnalyticsWorkspaceState): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const serialized = serializeAwParam(state);
    if (serialized) url.searchParams.set(URL_PARAM, serialized);
    else url.searchParams.delete(URL_PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}

const AnalyticsWorkspaceContext = createContext<AnalyticsWorkspaceContextValue | null>(null);

export const AnalyticsWorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AnalyticsWorkspaceState>(() => ({
    ...loadInitial(),
    ...readUrlOverrides(),
  }));
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: AnalyticsWorkspaceState) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    urlTimerRef.current = setTimeout(() => writeUrlFromState(next), URL_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    },
    [],
  );

  const value = useMemo<AnalyticsWorkspaceContextValue>(
    () => ({
      ...state,
      setPeriodPreset: (periodPreset) => persist({ ...state, periodPreset }),
      setScope: (scope) => persist({ ...state, scope }),
      setSelectedCategory: (selectedCategory) => persist({ ...state, selectedCategory }),
      setSelectedMonthKey: (selectedMonthKey) => persist({ ...state, selectedMonthKey }),
      setWealthZone: (wealthZone) => persist({ ...state, wealthZone }),
      setAnalysisExplorerTab: (analysisExplorerTab) => persist({ ...state, analysisExplorerTab }),
      setAnalysisStudioTab: (analysisStudioTab) => persist({ ...state, analysisStudioTab }),
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

export { parseAwParam, serializeAwParam, URL_PARAM, URL_DEBOUNCE_MS };

/** Alias for E2E tests and deep-link docs. */
export const parseAnalyticsWorkspaceFromSearch = parseAwParam;
