import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCanonicalSpotFx } from './useCanonicalFinancialMetrics';
import { buildEnhancementSignals } from '../services/financialEnhancementSignals';

/** Single drift/goal-conflict scan per data + FX change (shared by notifications + enhancement panels). */
export function useEnhancementSignals() {
  const { data } = useContext(DataContext)!;
  const sarPerUsd = useCanonicalSpotFx();
  return useMemo(() => {
    if (!data) return { goalConflicts: [], budgetDrift: [] };
    return buildEnhancementSignals(data, sarPerUsd);
  }, [data, sarPerUsd]);
}
