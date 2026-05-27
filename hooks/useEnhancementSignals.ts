import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCanonicalSpotFx } from './useCanonicalFinancialMetrics';
import { buildEnhancementSignals } from '../services/financialEnhancementSignals';
import { buildNotificationsDataFingerprint } from '../services/budgetSpendFingerprint';

/** Single drift/goal-conflict scan per data + FX change (shared by notifications + enhancement panels). */
export function useEnhancementSignals() {
  const { data, showHydrateBanner } = useContext(DataContext)!;
  const sarPerUsd = useCanonicalSpotFx();
  const dataFingerprint = useMemo(
    () => buildNotificationsDataFingerprint(data),
    [
      data?.budgets,
      data?.goals,
      data?.transactions,
      (data as { personalTransactions?: unknown[] })?.personalTransactions,
      data?.settings?.budgetThreshold,
      data?.investmentPlan,
    ],
  );
  return useMemo(() => {
    if (!data || showHydrateBanner) return { goalConflicts: [], budgetDrift: [] };
    return buildEnhancementSignals(data, sarPerUsd);
  }, [data, dataFingerprint, sarPerUsd, showHydrateBanner]);
}
