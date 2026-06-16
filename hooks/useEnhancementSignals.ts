import { useContext, useMemo, useEffect, useState, startTransition } from 'react';
import { DataContext } from '../context/DataContext';
import { useCanonicalSpotFx } from './useCanonicalFinancialMetrics';
import { buildEnhancementSignals } from '../services/financialEnhancementSignals';
import { buildNotificationsDataFingerprint } from '../services/budgetSpendFingerprint';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';

const EMPTY_SIGNALS = { goalConflicts: [] as ReturnType<typeof buildEnhancementSignals>['goalConflicts'], budgetDrift: [] as ReturnType<typeof buildEnhancementSignals>['budgetDrift'] };

/** Single drift/goal-conflict scan per data + FX change (deferred — shared by notifications + enhancement panels). */
export function useEnhancementSignals(exchangeRateOverride?: number) {
  const { data, showHydrateBanner } = useContext(DataContext)!;
  const spotFx = useCanonicalSpotFx();
  const sarPerUsd = exchangeRateOverride ?? spotFx;
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
  const [signals, setSignals] = useState(EMPTY_SIGNALS);

  useEffect(() => {
    if (!data || showHydrateBanner) {
      setSignals(EMPTY_SIGNALS);
      return;
    }

    let aborted = false;
    const cancelIdle = scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused() || aborted) return;
      await yieldToMain(0);
      if (isBackgroundWorkPaused() || aborted) return;
      const next = buildEnhancementSignals(data, sarPerUsd);
      startTransition(() => setSignals(next));
    }, 1500);

    return () => {
      aborted = true;
      cancelIdle();
    };
  }, [data, dataFingerprint, sarPerUsd, showHydrateBanner]);

  return signals;
}
