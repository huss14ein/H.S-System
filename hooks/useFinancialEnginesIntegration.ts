/**
 * Hook: Unified Financial Engines Integration
 * Builds shared context from Household, Budget, and Wealth Ultra data and runs cross-engine analysis.
 * Consumable by Plan, Budgets, Wealth Ultra, and Investment Plan for consistent cash/risk/household constraints.
 */

import { useMemo, useContext, useEffect, useState, useRef, startTransition } from 'react';
import { DataContext } from '../context/DataContext';
import {
  validateInvestmentAction,
  type UnifiedFinancialContext,
  type CrossEngineAnalysis,
  type CashConstraints,
  type RiskConstraints,
  type HouseholdConstraints,
} from '../services/engineIntegration';
import type { Page } from '../types';
import {
  computeFinancialEnginesIntegration,
  EMPTY_FINANCIAL_ENGINES_SNAPSHOT,
} from '../services/financialEnginesIntegrationCompute';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';

export interface UseFinancialEnginesIntegrationResult {
  /** Unified context (cash, risk, household) from all engines */
  context: UnifiedFinancialContext | null;
  /** Cross-engine analysis: alerts, investment/budget recommendations, summary */
  analysis: CrossEngineAnalysis | null;
  /** Prioritized action queue for control tower / dashboards */
  actionQueue: Array<{
    action: string;
    priority: number;
    category: string;
    details: string;
    links?: Array<{ label: string; page: Page; action?: string }>;
  }>;
  /** Validate an investment action against cash/risk/household constraints */
  validateAction: (action: { type: 'buy' | 'sell'; symbol: string; amount: number }) =>
    { isValid: boolean; reasons: string[]; warnings: string[] };
  /** Cash constraints for display or guards */
  cash: CashConstraints | null;
  /** Risk constraints for display or guards */
  risk: RiskConstraints | null;
  /** Household constraints (recurring bills, stress signals) for display or guards */
  household: HouseholdConstraints | null;
  /** Whether context and analysis are available (data loaded) */
  ready: boolean;
}

type Options = {
  /** When false, compute on idle time (Layout shell banner — keeps navigation snappy). */
  eager?: boolean;
};

/**
 * Build unified financial context and run cross-engine analysis from DataContext.
 * Use in Plan, Budgets, Wealth Ultra, and Investment Plan for shared constraints and alerts.
 */
export function useFinancialEnginesIntegration(options?: Options): UseFinancialEnginesIntegrationResult {
  const eager = options?.eager !== false;
  const { data, showHydrateBanner } = useContext(DataContext)!;
  const [idleSnapshot, setIdleSnapshot] = useState(EMPTY_FINANCIAL_ENGINES_SNAPSHOT);

  const dataFingerprint = useMemo(
    () =>
      [
        showHydrateBanner ? '1' : '0',
        data?.transactions?.length ?? 0,
        data?.accounts?.length ?? 0,
        data?.budgets?.length ?? 0,
        data?.goals?.length ?? 0,
        data?.investments?.length ?? 0,
        (data as { personalTransactions?: unknown[] })?.personalTransactions?.length ?? 0,
        (data as { personalAccounts?: unknown[] })?.personalAccounts?.length ?? 0,
        (data as { personalInvestments?: unknown[] })?.personalInvestments?.length ?? 0,
      ].join(':'),
    [data, showHydrateBanner],
  );

  const cachedSyncRef = useRef(EMPTY_FINANCIAL_ENGINES_SNAPSHOT);

  const syncResult = useMemo(() => {
    if (!eager) return EMPTY_FINANCIAL_ENGINES_SNAPSHOT;
    if (isBackgroundWorkPaused() && cachedSyncRef.current.ready) {
      return cachedSyncRef.current;
    }
    const next = computeFinancialEnginesIntegration(data, showHydrateBanner);
    if (next.ready) cachedSyncRef.current = next;
    return next;
  }, [eager, data, showHydrateBanner, dataFingerprint]);

  useEffect(() => {
    if (eager) return;
    if (!data || showHydrateBanner) {
      setIdleSnapshot(EMPTY_FINANCIAL_ENGINES_SNAPSHOT);
      return;
    }
    return scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused()) return;
      await yieldToMain(16);
      if (isBackgroundWorkPaused()) return;
      const next = computeFinancialEnginesIntegration(data, showHydrateBanner);
      startTransition(() => setIdleSnapshot(next));
    }, 2500);
  }, [eager, data, showHydrateBanner, dataFingerprint]);

  const result = eager ? syncResult : idleSnapshot;

  const validateAction = useMemo(() => {
    return (action: { type: 'buy' | 'sell'; symbol: string; amount: number }) => {
      if (!result.context) {
        return { isValid: false, reasons: ['Data not loaded'], warnings: [] };
      }
      return validateInvestmentAction(action, result.context);
    };
  }, [result.context]);

  return {
    ...result,
    validateAction,
  };
}
