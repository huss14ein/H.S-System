import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { FinancialData } from '../types';
import {
  computeExpenseBudgetAnalysisModel,
  type ExpenseAnalysisScope,
  type ExpenseBudgetAnalysisModel,
} from '../services/expenseBudgetAnalysisModel';
import type { AnalyticsPeriodPreset } from '../services/analyticsPeriodRange';
import { scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';

export type UseSpendingCommandCenterResult = {
  model: ExpenseBudgetAnalysisModel | null;
  ready: boolean;
};

/** Single idle-deferred spending model for Dashboard, Analysis, Budgets. */
export function useSpendingCommandCenterModel(
  data: FinancialData | null | undefined,
  exchangeRate: number,
  scope: ExpenseAnalysisScope = 'personal',
  enabled = true,
  periodPreset: AnalyticsPeriodPreset = 'MTD',
): UseSpendingCommandCenterResult {
  const deferredData = useDeferredValue(data);
  const computeData = deferredData ?? data;
  const [model, setModel] = useState<ExpenseBudgetAnalysisModel | null>(null);
  const [ready, setReady] = useState(false);

  const fingerprint = useMemo(
    () =>
      [
        computeData?.transactions?.length ?? 0,
        computeData?.budgets?.length ?? 0,
        exchangeRate,
        scope,
        periodPreset,
      ].join(':'),
    [computeData?.transactions?.length, computeData?.budgets?.length, exchangeRate, scope, periodPreset],
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
      const result = computeExpenseBudgetAnalysisModel(computeData, exchangeRate, new Date(), scope, periodPreset);
      if (aborted) return;
      startTransition(() => {
        setModel(result);
        setReady(true);
      });
    }, 120);
    return () => {
      aborted = true;
      cancel();
    };
  }, [enabled, computeData, exchangeRate, scope, periodPreset, fingerprint]);

  return { model, ready };
}
