/**
 * Integration glue: shared constraints (cash, risk) across Household, Budget, and Wealth Ultra engines.
 * Ensures they consume consistent caps and run without errors.
 */

import type { HouseholdStressSignals } from './householdBudgetEngine';
import type { WealthUltraConfig } from '../types';

export interface SharedConstraintsInput {
  /** From household engine: stress and suggested max investment. */
  householdStress?: HouseholdStressSignals | null;
  /** From budget engine: remaining budget or max investable this period. */
  budgetMaxInvestable?: number | null;
  /** Raw deployable cash from accounts (before household/budget caps). */
  rawDeployableCash: number;
  /** User risk profile or Wealth Ultra risk weights. */
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  /** Optional Wealth Ultra config to align reserve. */
  wealthUltraConfig?: WealthUltraConfig | null;
}

export interface SharedConstraintsResult {
  /** Cash cap to pass to Wealth Ultra (scenarioCashCap). */
  cappedDeployableCash: number;
  /** Reason for cap (for UI). */
  capReason: string;
  /** Whether household/budget suggest reducing investment. */
  reduceInvestmentSuggested: boolean;
  /** Suggested cash reserve (from household or WU config). */
  suggestedReserve: number;
  /** Constraints are valid and engines can run. */
  valid: boolean;
  /** Any warning message. */
  warning?: string;
}

/**
 * Compute shared constraints so Household, Budget, and Wealth Ultra stay in sync.
 */
export function computeSharedConstraints(input: SharedConstraintsInput): SharedConstraintsResult {
  let cappedDeployableCash = input.rawDeployableCash;
  let capReason = 'none';
  let reduceInvestmentSuggested = false;
  let suggestedReserve = 0;

  if (input.householdStress) {
    const h = input.householdStress;
    suggestedReserve = Math.max(suggestedReserve, h.minReservePool);
    if (h.overall === 'stress' || h.overall === 'critical') {
      cappedDeployableCash = Math.min(cappedDeployableCash, h.suggestedMaxInvestmentFromHousehold);
      if (h.suggestedMaxInvestmentFromHousehold < input.rawDeployableCash) {
        capReason = 'household_stress';
        reduceInvestmentSuggested = true;
      }
    } else if (h.overall === 'caution' && h.suggestedMaxInvestmentFromHousehold < cappedDeployableCash) {
      cappedDeployableCash = Math.min(cappedDeployableCash, h.suggestedMaxInvestmentFromHousehold);
      capReason = 'household_caution';
      reduceInvestmentSuggested = true;
    }
  }

  if (input.budgetMaxInvestable != null && input.budgetMaxInvestable >= 0 && input.budgetMaxInvestable < cappedDeployableCash) {
    cappedDeployableCash = input.budgetMaxInvestable;
    capReason = capReason === 'none' ? 'budget_limit' : 'household_and_budget';
    reduceInvestmentSuggested = true;
  }

  if (input.wealthUltraConfig && input.rawDeployableCash > 0) {
    const reserve = input.wealthUltraConfig.cashAvailable * (input.wealthUltraConfig.cashReservePct / 100);
    suggestedReserve = Math.max(suggestedReserve, reserve);
  }

  const valid = cappedDeployableCash >= 0;
  let warning: string | undefined;
  if (reduceInvestmentSuggested && capReason !== 'none') {
    warning = capReason === 'household_stress' || capReason === 'household_caution'
      ? 'Household cashflow suggests limiting investment until reserve is healthier.'
      : 'Budget limit caps deployable amount.';
  }

  return {
    cappedDeployableCash,
    capReason,
    reduceInvestmentSuggested,
    suggestedReserve,
    valid,
    warning,
  };
}
