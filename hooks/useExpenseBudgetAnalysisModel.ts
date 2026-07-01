import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { FinancialData } from '../types';
import {
  computeExpenseBudgetAnalysisModel,
  type ExpenseBudgetAnalysisModel,
} from '../services/expenseBudgetAnalysisModel';
import { scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';

export type UseExpenseBudgetAnalysisResult = {
  model: ExpenseBudgetAnalysisModel | null;
  ready: boolean;
};

/**
 * Idle-deferred expense/budget analysis — does not block Analysis route paint or quote ticks.
 */
export function useExpenseBudgetAnalysisModel(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  enabled = true,
): UseExpenseBudgetAnalysisResult {
  const deferredData = useDeferredValue(data);
  const computeData = deferredData ?? data;
  const [model, setModel] = useState<ExpenseBudgetAnalysisModel | null>(null);
  const [ready, setReady] = useState(false);

  const fingerprint = useMemo(
    () =>
      [
        computeData?.transactions?.length ?? 0,
        computeData?.budgets?.length ?? 0,
        computeData?.accounts?.length ?? 0,
        exchangeRate,
      ].join(':'),
    [computeData?.transactions?.length, computeData?.budgets?.length, computeData?.accounts?.length, exchangeRate],
  );

  useEffect(() => {
    if (!enabled || !computeData) {
      setModel(null);
      setReady(false);
      return;
    }

    let aborted = false;
    setReady(false);

    const cancel = scheduleIdleWorkAsync(async () => {
      await waitUntilBackgroundWorkResumed();
      await yieldToMain();
      if (aborted) return;

      const result = computeExpenseBudgetAnalysisModel(computeData, exchangeRate);
      if (aborted) return;

      startTransition(() => {
        setModel(result);
        setReady(true);
      });
    }, 150);

    return () => {
      aborted = true;
      cancel();
    };
  }, [enabled, computeData, exchangeRate, fingerprint]);

  return { model, ready };
}
