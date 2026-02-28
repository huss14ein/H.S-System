import type { Holding } from '../types';
import type {
  WealthUltraConfig,
  WealthUltraPosition,
  WealthUltraSleeveAllocation,
  WealthUltraOrder,
  WealthUltraAlert,
} from '../types';
import { getDefaultWealthUltraConfig, validateWealthUltraConfig } from './config';
import { buildWealthUltraPositions, type PriceMap } from './position';
import { getTotalPortfolioValue, computeSleeveAllocations } from './allocationEngine';
import { computePlannedAdjustment } from './adjustmentEngine';
import { applyExitEngine } from './exitEngine';
import { runCashPlanner } from './cashPlanner';
import { generateOrders } from './orderGenerator';
import { runMonthlyCoreDeployment } from './monthlyDeployment';
import { isSpecBreach, shouldDisableNewSpecBuys } from './specRisk';
import { rankByCapitalEfficiency } from './capitalEfficiency';
import { runAlertEngine } from './alertEngine';

export type WealthUltraEngineInput = {
  holdings: Holding[];
  priceMap: PriceMap;
  config?: Partial<WealthUltraConfig>;
  sleeveOverrides?: Record<string, 'Core' | 'Upside' | 'Spec'>;
};

export interface WealthUltraEngineState {
  config: WealthUltraConfig;
  positions: WealthUltraPosition[];
  allocations: WealthUltraSleeveAllocation[];
  totalPortfolioValue: number;
  deployableCash: number;
  cashPlannerStatus: 'WITHIN_LIMIT' | 'OVER_BUDGET';
  totalPlannedBuyCost: number;
  orders: WealthUltraOrder[];
  monthlyDeployment: ReturnType<typeof runMonthlyCoreDeployment>;
  specBreach: boolean;
  specBuysDisabled: boolean;
  capitalEfficiencyRanked: WealthUltraPosition[];
  alerts: WealthUltraAlert[];
}

export function runWealthUltraEngine(input: WealthUltraEngineInput): WealthUltraEngineState {
  const config: WealthUltraConfig = {
    ...getDefaultWealthUltraConfig(),
    ...input.config,
  };
  const validation = validateWealthUltraConfig(config);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid Wealth Ultra configuration');
  }

  let positions = buildWealthUltraPositions(input.holdings, input.priceMap, input.sleeveOverrides, config);
  positions = applyExitEngine(positions, config);
  positions = positions.map(p => computePlannedAdjustment(p));

  const totalPortfolioValue = getTotalPortfolioValue(positions);
  const allocations = computeSleeveAllocations(positions, config, totalPortfolioValue);
  const { deployableCash, totalPlannedBuyCost, status: cashPlannerStatus } = runCashPlanner(config, positions);
  const orders = generateOrders(positions);
  const monthlyDeployment = runMonthlyCoreDeployment(config, positions, allocations);
  const specAlloc = allocations.find(a => a.sleeve === 'Spec');
  const specBreach = isSpecBreach(config, specAlloc);
  const specBuysDisabled = shouldDisableNewSpecBuys(config, specAlloc);
  const capitalEfficiencyRanked = rankByCapitalEfficiency(positions, config);
  const alerts = runAlertEngine(config, positions, allocations);

  return {
    config,
    positions,
    allocations,
    totalPortfolioValue,
    deployableCash,
    cashPlannerStatus,
    totalPlannedBuyCost,
    orders,
    monthlyDeployment,
    specBreach,
    specBuysDisabled,
    capitalEfficiencyRanked,
    alerts,
  };
}

export {
  getDefaultWealthUltraConfig,
  validateWealthUltraConfig,
  getRiskWeight,
} from './config';
export { buildWealthUltraPositions, tickerToSleeve, tickerToRiskTier } from './position';
export type { PriceMap } from './position';
export { getTotalPortfolioValue, computeSleeveAllocations, isDriftAlert, DRIFT_ALERT_PCT } from './allocationEngine';
export { computePlannedAdjustment, validateAdjustment, getTotalPlannedBuyCost } from './adjustmentEngine';
export { computeExitPrices, applyExitEngine } from './exitEngine';
export { runCashPlanner, computeDeployableCash } from './cashPlanner';
export type { CashPlannerResult } from './cashPlanner';
export { generateOrders, exportOrdersJson } from './orderGenerator';
export { runMonthlyCoreDeployment } from './monthlyDeployment';
export type { MonthlyDeploymentResult } from './monthlyDeployment';
export { isSpecBreach, shouldDisableNewSpecBuys } from './specRisk';
export { capitalEfficiencyScore, rankByCapitalEfficiency } from './capitalEfficiency';
export { runAlertEngine } from './alertEngine';
