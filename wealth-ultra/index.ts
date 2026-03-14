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
import { attachRiskScores } from './riskScoring';
import { rankTrades, positionsByTradeRank } from './tradeRanking';
import { computeDiversification, type DiversificationResult } from './diversification';

export type WealthUltraEngineInput = {
  holdings: Holding[];
  priceMap: PriceMap;
  config?: Partial<WealthUltraConfig>;
  sleeveOverrides?: Record<string, 'Core' | 'Upside' | 'Spec'>;
  /** Scenario hook: cap deployable cash (e.g. from household engine). */
  scenarioCashCap?: number;
  /** Scenario hook: override sleeve targets for stress tests. */
  scenarioTargetOverrides?: Partial<Record<'Core' | 'Upside' | 'Spec', number>>;
};

export interface WealthUltraPortfolioHealth {
  score: number;
  label: string;
  summary: string;
}

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
  /** Positions with riskScore and tradeRank; sorted by trade execution priority. */
  tradeRankedPositions: WealthUltraPosition[];
  /** Diversification and concentration analysis. */
  diversification: DiversificationResult;
  alerts: WealthUltraAlert[];
  portfolioHealth: WealthUltraPortfolioHealth;
}

export function runWealthUltraEngine(input: WealthUltraEngineInput): WealthUltraEngineState {
  let config: WealthUltraConfig = {
    ...getDefaultWealthUltraConfig(),
    ...input.config,
  };
  if (input.scenarioTargetOverrides) {
    if (input.scenarioTargetOverrides.Core != null) config = { ...config, targetCorePct: input.scenarioTargetOverrides.Core };
    if (input.scenarioTargetOverrides.Upside != null) config = { ...config, targetUpsidePct: input.scenarioTargetOverrides.Upside };
    if (input.scenarioTargetOverrides.Spec != null) config = { ...config, targetSpecPct: input.scenarioTargetOverrides.Spec };
  }
  const validation = validateWealthUltraConfig(config);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid Wealth Ultra configuration');
  }

  let positions = buildWealthUltraPositions(input.holdings, input.priceMap, input.sleeveOverrides, config);
  positions = applyExitEngine(positions, config);
  positions = positions.map(p => computePlannedAdjustment(p));

  const totalPortfolioValue = getTotalPortfolioValue(positions);
  const allocations = computeSleeveAllocations(positions, config, totalPortfolioValue);
  let { deployableCash, totalPlannedBuyCost, status: cashPlannerStatus } = runCashPlanner(config, positions);
  if (input.scenarioCashCap != null && input.scenarioCashCap >= 0) {
    deployableCash = Math.min(deployableCash, input.scenarioCashCap);
    if (totalPlannedBuyCost > deployableCash) cashPlannerStatus = 'OVER_BUDGET';
  }
  const orders = generateOrders(positions);
  const monthlyDeployment = runMonthlyCoreDeployment(config, positions, allocations);
  const specAlloc = allocations.find(a => a.sleeve === 'Spec');
  const specBreach = isSpecBreach(config, specAlloc);
  const specBuysDisabled = shouldDisableNewSpecBuys(config, specAlloc);
  const capitalEfficiencyRanked = rankByCapitalEfficiency(positions, config);

  positions = attachRiskScores(positions, totalPortfolioValue, config);
  const sleeveDrift: Record<string, number> = {};
  for (const a of allocations) sleeveDrift[a.sleeve] = a.driftPct;
  positions = rankTrades(positions, config, sleeveDrift);
  const tradeRankedPositions = positionsByTradeRank(positions);
  const diversification = computeDiversification(positions, totalPortfolioValue);

  const alerts = runAlertEngine(config, positions, allocations, monthlyDeployment);

  const portfolioHealth = computePortfolioHealth(
    config,
    allocations,
    cashPlannerStatus,
    specBreach,
    alerts
  );

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
    tradeRankedPositions,
    diversification,
    alerts,
    portfolioHealth,
  };
}

function computePortfolioHealth(
  config: WealthUltraConfig,
  allocations: WealthUltraSleeveAllocation[],
  cashPlannerStatus: 'WITHIN_LIMIT' | 'OVER_BUDGET',
  specBreach: boolean,
  alerts: WealthUltraAlert[]
): WealthUltraPortfolioHealth {
  // config is currently only used for future scoring heuristics; reference to satisfy strict noUnusedParameters.
  void config;
  let score = 100;
  const reasons: string[] = [];

  if (cashPlannerStatus === 'OVER_BUDGET') {
    score -= 30;
    reasons.push('Planned buys over deployable cash');
  }
  if (specBreach) {
    score -= 20;
    reasons.push('Spec sleeve over target');
  }
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  if (criticalCount > 0) {
    score -= Math.min(25, criticalCount * 10);
    reasons.push(`${criticalCount} critical alert${criticalCount !== 1 ? 's' : ''}`);
  }
  if (warningCount > 0) {
    score -= Math.min(15, warningCount * 5);
    if (!reasons.length) reasons.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
  }
  for (const a of allocations) {
    const absDrift = Math.abs(a.driftPct);
    if (absDrift > 10) {
      score -= Math.min(10, Math.floor(absDrift / 2));
      if (!reasons.some(r => r.includes('drift'))) reasons.push('Sleeve drift from target');
    }
  }

  score = Math.max(0, Math.min(100, score));

  let label: string;
  let summary: string;
  if (score >= 85) {
    label = 'In sync';
    summary = 'Allocation and cash plan are on track. Use opportunities below to refine.';
  } else if (score >= 65) {
    label = 'Minor review';
    summary = reasons.length ? reasons.slice(0, 2).join('; ') + '.' : 'Small drift or warnings.';
  } else if (score >= 40) {
    label = 'Rebalance suggested';
    summary = reasons.length ? reasons.join('; ') + '.' : 'Review alerts and orders.';
  } else {
    label = 'Action needed';
    summary = 'Address critical alerts and cash plan first.';
  }

  return { score, label, summary };
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
export { attachRiskScores, positionRiskScore } from './riskScoring';
export { rankTrades, positionsByTradeRank } from './tradeRanking';
export { computeDiversification } from './diversification';
export type { DiversificationResult } from './diversification';
