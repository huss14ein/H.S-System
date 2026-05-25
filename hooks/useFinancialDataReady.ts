import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { financialDataHasHydrated } from '../services/financialDataHydration';

/** Re-export for pages that prefer a hook over destructuring DataContext. */
export { financialDataHasHydrated } from '../services/financialDataHydration';

/**
 * True only on the first load before any personal rows exist.
 * Prefer `showBlockingLoader` from DataContext when already using that provider.
 */
export function useShowFinancialDataBlockingLoader(): boolean {
  const { data, loading } = useContext(DataContext)!;
  return useMemo(() => loading && !financialDataHasHydrated(data), [data, loading]);
}
