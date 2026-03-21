/**
 * Hook: Unified Financial Engines Integration
 * Builds shared context from Household, Budget, and Wealth Ultra data and runs cross-engine analysis.
 * Consumable by Plan, Budgets, Wealth Ultra, and Investment Plan for consistent cash/risk/household constraints.
 */

import { useMemo, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getPersonalTransactions, getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import {
  buildUnifiedFinancialContext,
  runCrossEngineAnalysis,
  generatePrioritizedActionQueue,
  validateInvestmentAction,
  type UnifiedFinancialContext,
  type CrossEngineAnalysis,
  type CashConstraints,
  type RiskConstraints,
  type HouseholdConstraints,
} from '../services/engineIntegration';
import type { Holding, InvestmentPortfolio } from '../types';

function mapInvestmentsForContext(
  investments: InvestmentPortfolio[]
): Array<{
  id: string;
  symbol: string;
  quantity: number;
  shares: number;
  averageCost: number;
  avgCost: number;
  currentPrice: number;
  type: string;
}> {
  const out: Array<{
    id: string;
    symbol: string;
    quantity: number;
    shares: number;
    averageCost: number;
    avgCost: number;
    currentPrice: number;
    type: string;
  }> = [];
  (investments ?? []).forEach((port) => {
    (port.holdings ?? []).forEach((h: Holding) => {
      const q = Number(h.quantity ?? 0);
      const price = Number(h.currentValue ?? 0) / (q || 1) || Number(h.avgCost ?? 0);
      out.push({
        id: h.id ?? `${port.id}-${h.symbol}`,
        symbol: h.symbol ?? '',
        quantity: q,
        shares: q,
        averageCost: Number(h.avgCost ?? 0),
        avgCost: Number(h.avgCost ?? 0),
        currentPrice: price,
        type: 'stock',
      });
    });
  });
  return out;
}

export interface UseFinancialEnginesIntegrationResult {
  /** Unified context (cash, risk, household) from all engines */
  context: UnifiedFinancialContext | null;
  /** Cross-engine analysis: alerts, investment/budget recommendations, summary */
  analysis: CrossEngineAnalysis | null;
  /** Prioritized action queue for control tower / dashboards */
  actionQueue: Array<{ action: string; priority: number; category: string; details: string }>;
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

/**
 * Build unified financial context and run cross-engine analysis from DataContext.
 * Use in Plan, Budgets, Wealth Ultra, and Investment Plan for shared constraints and alerts.
 */
export function useFinancialEnginesIntegration(): UseFinancialEnginesIntegrationResult {
  const { data } = useContext(DataContext)!;

  const result = useMemo(() => {
    if (!data) {
      return {
        context: null,
        analysis: null,
        actionQueue: [],
        cash: null,
        risk: null,
        household: null,
        ready: false,
      };
    }

    const transactions = getPersonalTransactions(data);
    const accounts = getPersonalAccounts(data);
    const budgets = data.budgets ?? [];
    const goals = data.goals ?? [];
    const investments = getPersonalInvestments(data);
    const investmentsFlat = mapInvestmentsForContext(investments);

    const context = buildUnifiedFinancialContext(
      transactions,
      accounts,
      budgets,
      goals,
      investmentsFlat
    );

    const analysis = runCrossEngineAnalysis(context);
    const actionQueue = generatePrioritizedActionQueue(analysis);

    return {
      context,
      analysis,
      actionQueue,
      cash: context.cash,
      risk: context.risk,
      household: context.household,
      ready: true,
    };
  }, [
    data?.transactions,
    data?.accounts,
    data?.budgets,
    data?.goals,
    data?.investments,
    (data as { personalTransactions?: unknown })?.personalTransactions,
    (data as { personalAccounts?: unknown })?.personalAccounts,
    (data as { personalInvestments?: unknown })?.personalInvestments,
  ]);

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
