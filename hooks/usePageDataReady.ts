import { useContext } from 'react';
import { DataContext } from '../context/DataContext';
import type { FinancialData } from '../types';

/** True when personal data hydrate finished — use to skip heavy page memos during first load. */
export function usePageDataReady(): {
  data: FinancialData | null;
  showHydrateBanner: boolean;
  ready: boolean;
} {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  return {
    data,
    showHydrateBanner,
    ready: Boolean(data && !showHydrateBanner),
  };
}
