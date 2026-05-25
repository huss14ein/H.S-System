import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCanonicalSpotFx } from './useCanonicalFinancialMetrics';
import { AuthContext } from '../context/AuthContext';
import { computeCapitalDeployment } from '../services/capitalDeploymentOrchestrator';
import { detectGoalConflictsFromData } from '../services/goalConflictDetection';
import { detectBudgetDrift } from '../services/budgetDrift';
import { evaluateLifestyleGuardrailsFromData } from '../services/lifestyleGuardrails';
import { computeIncomeStability } from '../services/incomeStability';
import { computeMonthlyCashflowKpisSar } from '../services/financeTruth';
import { getPersonalTransactions } from '../utils/wealthScope';

const EF_TARGET = 6;

export function useFinancialEnhancementInsights(emergencyFundMonths = 0) {
  const { data, getAvailableCashForAccount } = useContext(DataContext)!;
  const exchangeRate = useCanonicalSpotFx();
  const auth = useContext(AuthContext);

  return useMemo(() => {
    if (!data) {
      return {
        capitalDeployment: null,
        goalConflicts: [],
        budgetDrift: [],
        lifestyleHits: [],
        incomeStability: null,
        monthlySurplusSar: 0,
      };
    }
    const txs = getPersonalTransactions(data);
    const cf = computeMonthlyCashflowKpisSar({
      data,
      uiSarPerUsd: exchangeRate,
      accounts: data.accounts ?? [],
      transactions: txs,
    });
    const monthlySurplusSar = Math.max(0, cf.netSar);
    const savingsRate = cf.incomeSar > 0 ? cf.netSar / cf.incomeSar : 0;

    return {
      capitalDeployment: computeCapitalDeployment(
        data,
        exchangeRate,
        getAvailableCashForAccount,
        emergencyFundMonths,
        EF_TARGET,
      ),
      goalConflicts: detectGoalConflictsFromData(data, exchangeRate),
      budgetDrift: detectBudgetDrift(data, exchangeRate),
      lifestyleHits: evaluateLifestyleGuardrailsFromData(data, emergencyFundMonths, EF_TARGET, savingsRate),
      incomeStability: computeIncomeStability(data),
      monthlySurplusSar,
      userId: auth?.user?.id,
    };
  }, [data, exchangeRate, getAvailableCashForAccount, emergencyFundMonths, auth?.user?.id]);
}
