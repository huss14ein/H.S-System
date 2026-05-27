import { useContext, useEffect, useState } from 'react';
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
import { scheduleIdleWork } from '../utils/runWhenIdle';
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
export function useFinancialEnhancementInsights(emergencyFundMonths = 0): FinancialEnhancementInsights {
  const { data, showHydrateBanner, getAvailableCashForAccount } = useContext(DataContext)!;
  const exchangeRate = useCanonicalSpotFx();
  const auth = useContext(AuthContext);
  const { goalConflicts, budgetDrift } = useEnhancementSignals();
  const [result, setResult] = useState<FinancialEnhancementInsights>(EMPTY);

  useEffect(() => {
    if (!data || showHydrateBanner) {
      setResult(EMPTY);
      return;
    }

    return scheduleIdleWork(() => {
      const txs = getPersonalTransactions(data);
      const cf = computeMonthlyCashflowKpisSar({
        data,
        uiSarPerUsd: exchangeRate,
        accounts: data.accounts ?? [],
        transactions: txs,
      });
      const monthlySurplusSar = Math.max(0, cf.netSar);
      const savingsRate = cf.incomeSar > 0 ? cf.netSar / cf.incomeSar : 0;

      setResult({
        capitalDeployment: computeCapitalDeployment(
          data,
          exchangeRate,
          getAvailableCashForAccount,
          emergencyFundMonths,
          EF_TARGET,
        ),
        goalConflicts,
        budgetDrift,
        lifestyleHits: evaluateLifestyleGuardrailsFromData(data, emergencyFundMonths, EF_TARGET, savingsRate),
        incomeStability: computeIncomeStability(data),
        monthlySurplusSar,
        userId: auth?.user?.id,
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
