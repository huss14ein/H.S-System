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
  alerts: WealthUltraAlert[];
  portfolioHealth: WealthUltraPortfolioHealth;
  diversificationSummary: WealthUltraDiversificationSummary;
  rebalancePolicy: WealthUltraRebalancePolicy;
}

export interface WealthUltraDiversificationSummary {
  uniqueTickers: number;
  topConcentrationPct: number;
  topTickers: string[];
}

export interface WealthUltraRebalancePolicy {
  mode: 'ON_TRACK' | 'MINOR_ADJUST' | 'REBALANCE' | 'DE_RISK';
  reasons: string[];
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
  const alerts = runAlertEngine(config, positions, allocations, monthlyDeployment);

  const portfolioHealth = computePortfolioHealth(
    config,
    allocations,
    cashPlannerStatus,
    specBreach,
    alerts
  );

  const diversificationSummary = computeDiversificationSummary(positions, totalPortfolioValue);
  const rebalancePolicy = deriveRebalancePolicy(allocations, alerts);

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
    portfolioHealth,
    diversificationSummary,
    rebalancePolicy,
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

function computeDiversificationSummary(
  positions: WealthUltraPosition[],
  totalPortfolioValue: number
): WealthUltraDiversificationSummary {
  if (!positions.length || totalPortfolioValue <= 0) {
    return { uniqueTickers: 0, topConcentrationPct: 0, topTickers: [] };
  }
  const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
  const uniqueTickers = new Set(sorted.map((p) => p.ticker)).size;
  const top = sorted.slice(0, 3);
  const topValue = top.reduce((sum, p) => sum + p.marketValue, 0);
  const topConcentrationPct = (topValue / totalPortfolioValue) * 100;
  const topTickers = top.map((p) => p.ticker);
  return { uniqueTickers, topConcentrationPct, topTickers };
}

function deriveRebalancePolicy(
  allocations: WealthUltraSleeveAllocation[],
  alerts: WealthUltraAlert[]
): WealthUltraRebalancePolicy {
  const reasons: string[] = [];
  const hasCritical = alerts.some((a) => a.severity === 'critical');
  const hasWarning = alerts.some((a) => a.severity === 'warning');
  const maxDrift = allocations.reduce(
    (max, a) => Math.max(max, Math.abs(a.driftPct)),
    0
  );

  if (hasCritical) reasons.push('Critical portfolio alerts active');
  if (hasWarning && !hasCritical) reasons.push('Warning-level allocation or risk alerts active');
  if (maxDrift > 10) reasons.push('At least one sleeve drift exceeds 10% from target');
  else if (maxDrift > 5) reasons.push('Sleeve drift between 5–10% from target');

  let mode: WealthUltraRebalancePolicy['mode'] = 'ON_TRACK';
  if (hasCritical || maxDrift > 12) mode = 'DE_RISK';
  else if (hasWarning || maxDrift > 8) mode = 'REBALANCE';
  else if (maxDrift > 3) mode = 'MINOR_ADJUST';

  return { mode, reasons };
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
