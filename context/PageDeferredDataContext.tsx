import React, { createContext, useContext, useDeferredValue, useMemo } from 'react';
import { DataContext } from './DataContext';
import type { FinancialData } from '../types';

type PageDeferredDataContextValue = {
  /** Deferred snapshot for heavy derived state (non-blocking during quote ticks / navigation). */
  computeData: FinancialData | null;
  showHydrateBanner: boolean;
  ready: boolean;
};

const PageDeferredDataContext = createContext<PageDeferredDataContextValue | null>(null);

/** Wraps page content so heavy memos can read deferred data without blocking navigation paint. */
export function PageDeferredDataProvider({ children }: { children: React.ReactNode }) {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const deferredData = useDeferredValue(showHydrateBanner ? null : data);

  const value = useMemo(
    (): PageDeferredDataContextValue => ({
      computeData: deferredData ?? data,
      showHydrateBanner,
      ready: Boolean(data && !showHydrateBanner),
    }),
    [data, deferredData, showHydrateBanner],
  );

  return <PageDeferredDataContext.Provider value={value}>{children}</PageDeferredDataContext.Provider>;
}

export function usePageDeferredData(): PageDeferredDataContextValue {
  const ctx = useContext(PageDeferredDataContext);
  if (!ctx) {
    throw new Error('usePageDeferredData must be used within PageDeferredDataProvider');
  }
  return ctx;
}
