import { useContext, useEffect, useState, startTransition } from 'react';
import { DataContext } from '../context/DataContext';
import { useCanonicalSpotFx } from './useCanonicalFinancialMetrics';
import { AuthContext } from '../context/AuthContext';
import { computeCapitalDeployment } from '../services/capitalDeploymentOrchestrator';
import { useEnhancementSignals } from './useEnhancementSignals';
import { buildEnhancementSignals } from '../services/financialEnhancementSignals';
import { evaluateLifestyleGuardrailsFromData } from '../services/lifestyleGuardrails';
import { computeIncomeStability } from '../services/incomeStability';
import { computeMonthlyCashflowKpisSar } from '../services/financeTruth';
import { getPersonalTransactions } from '../utils/wealthScope';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { yieldToMain } from '../utils/yieldToMain';
import type { CapitalDeploymentAnswer } from '../services/capitalDeploymentOrchestrator';

const EF_TARGET = 6;

export type FinancialEnhancementInsights = {
  capitalDeployment: CapitalDeploymentAnswer | null;
  goalConflicts: ReturnType<typeof buildEnhancementSignals>['goalConflicts'];
  budgetDrift: ReturnType<typeof buildEnhancementSignals>['budgetDrift'];
  lifestyleHits: ReturnType<typeof evaluateLifestyleGuardrailsFromData>;
  incomeStability: ReturnType<typeof computeIncomeStability> | null;
  monthlySurplusSar: number;
  userId?: string;
};

const EMPTY: FinancialEnhancementInsights = {
  capitalDeployment: null,
  goalConflicts: [],
  budgetDrift: [],
  lifestyleHits: [],
  incomeStability: null,
  monthlySurplusSar: 0,
};

/** Enhancement panels — deferred to idle time and skipped during hydrate (Dashboard, Budgets, Plan, etc.). */
export function useFinancialEnhancementInsights(
  emergencyFundMonths = 0,
  options?: { exchangeRate?: number },
): FinancialEnhancementInsights {
  const { data, showHydrateBanner, getAvailableCashForAccount } = useContext(DataContext)!;
  const spotFx = useCanonicalSpotFx();
  const exchangeRate = options?.exchangeRate ?? spotFx;
  const auth = useContext(AuthContext);
  const { goalConflicts, budgetDrift } = useEnhancementSignals();
  const [result, setResult] = useState<FinancialEnhancementInsights>(EMPTY);

  useEffect(() => {
    if (!data || showHydrateBanner) {
      setResult(EMPTY);
      return;
    }

    return scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused()) return;
      const txs = getPersonalTransactions(data);
      const cf = computeMonthlyCashflowKpisSar({
        data,
        uiSarPerUsd: exchangeRate,
        accounts: data.accounts ?? [],
        transactions: txs,
      });
      const monthlySurplusSar = Math.max(0, cf.netSar);
      const savingsRate = cf.incomeSar > 0 ? cf.netSar / cf.incomeSar : 0;

      await yieldToMain(16);
      if (isBackgroundWorkPaused()) return;

      const capitalDeployment = computeCapitalDeployment(
        data,
        exchangeRate,
        getAvailableCashForAccount,
        emergencyFundMonths,
        EF_TARGET,
      );
      const lifestyleHits = evaluateLifestyleGuardrailsFromData(
        data,
        emergencyFundMonths,
        EF_TARGET,
        savingsRate,
      );
      const incomeStability = computeIncomeStability(data);

      startTransition(() => {
        setResult({
          capitalDeployment,
          goalConflicts,
          budgetDrift,
          lifestyleHits,
          incomeStability,
          monthlySurplusSar,
          userId: auth?.user?.id,
        });
      });
    }, 2500);
  }, [
    data,
    showHydrateBanner,
    exchangeRate,
    getAvailableCashForAccount,
    emergencyFundMonths,
    auth?.user?.id,
    goalConflicts,
    budgetDrift,
  ]);

  return result;
}
