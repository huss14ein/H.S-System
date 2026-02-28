/**
 * Recovery Plan (Averaging / Correction Engine)
 * State machine + ladder planner + exit planner. Only activates for positions meeting strict rules.
 */

import type {
  RecoveryPlanState,
  RecoveryPositionConfig,
  RecoveryLadderLevel,
  RecoveryExitPlan,
  RecoveryGlobalConfig,
  RecoveryPlanResult,
  RecoveryOrderDraft,
  WealthUltraRiskTier,
  WealthUltraSleeve,
} from '../types';
import type { Holding } from '../types';

// --- Position metrics ---

export function positionMetrics(holding: Holding, currentPrice: number) {
  const shares = holding.quantity;
  const avgCost = holding.avgCost;
  const costBasis = shares * avgCost;
  const marketValue = shares * currentPrice;
  const plUsd = marketValue - costBasis;
  const plPct = costBasis > 0 ? (plUsd / costBasis) * 100 : 0;
  return { costBasis, marketValue, plUsd, plPct, shares, avgCost, currentPrice };
}

// --- Default config ---

export const DEFAULT_RECOVERY_GLOBAL_CONFIG: RecoveryGlobalConfig = {
  deployableCash: 0,
  reservePct: 10,
  maxPerTickerPct: 20,
  recoveryBudgetPct: 0.2,
  specFreezeRules: true,
  minDeployableThreshold: 500,
  ladderStepsByRisk: {
    Low: [0.05, 0.09, 0.13],
    Med: [0.07, 0.12, 0.18],
    High: [0.08, 0.15, 0.25],
    Spec: [0.1, 0.2, 0.35],
  },
  ladderWeights: [0.4, 0.35, 0.25],
};

// --- RiskGuardrailsValidator: cap and freeze checks ---

export function violatesCaps(
  position: RecoveryPositionConfig,
  planCost: number,
  config: RecoveryGlobalConfig
): { ok: boolean; reason?: string } {
  if (planCost > position.cashCap) {
    return { ok: false, reason: `Planned cost exceeds ticker cash cap (${position.cashCap})` };
  }
  const maxFromDeployable = config.deployableCash * config.recoveryBudgetPct;
  if (planCost > maxFromDeployable) {
    return { ok: false, reason: `Exceeds recovery budget (${(config.recoveryBudgetPct * 100).toFixed(0)}% of deployable)` };
  }
  if (config.deployableCash < config.minDeployableThreshold) {
    return { ok: false, reason: 'Deployable cash below minimum threshold' };
  }
  if (position.maxAddCost != null && planCost > position.maxAddCost) {
    return { ok: false, reason: `Exceeds max add cost (${position.maxAddCost})` };
  }
  return { ok: true };
}

export function riskGuardrailsValidator(
  position: RecoveryPositionConfig,
  config: RecoveryGlobalConfig,
  planCost: number
): { allowed: boolean; reason?: string } {
  if (config.specFreezeRules && position.riskTier === 'Spec') {
    return { allowed: false, reason: 'Recovery frozen for Spec (policy)' };
  }
  const caps = violatesCaps(position, planCost, config);
  if (!caps.ok) return { allowed: false, reason: caps.reason };
  return { allowed: true };
}

// --- RecoveryEligibilityService: qualify for recovery ---

export function qualifyRecovery(
  plPct: number,
  position: RecoveryPositionConfig,
  config: RecoveryGlobalConfig,
  estimatedPlanCost: number
): { qualified: boolean; reason?: string } {
  if (!position.recoveryEnabled) {
    return { qualified: false, reason: 'Recovery disabled for this position' };
  }
  if (plPct > -position.lossTriggerPct) {
    return { qualified: false, reason: `Loss ${(-plPct).toFixed(1)}% below trigger ${position.lossTriggerPct}%` };
  }
  const guard = riskGuardrailsValidator(position, config, estimatedPlanCost);
  if (!guard.allowed) {
    return { qualified: false, reason: guard.reason };
  }
  return { qualified: true };
}

// --- LadderAllocator: percent-based ladder + quantity allocation ---

export function buildLadderPrices(
  currentPrice: number,
  riskTier: WealthUltraRiskTier,
  config: RecoveryGlobalConfig
): number[] {
  const steps = config.ladderStepsByRisk[riskTier] ?? config.ladderStepsByRisk.Med;
  return steps.map(s => currentPrice * (1 - s));
}

export function allocateLadderQty(
  totalBudget: number,
  prices: number[],
  weights: [number, number, number]
): RecoveryLadderLevel[] {
  const levels: RecoveryLadderLevel[] = [];
  for (let i = 0; i < Math.min(3, prices.length); i++) {
    const weight = weights[i] ?? 0;
    const cost = totalBudget * weight;
    const price = prices[i];
    const qty = price > 0 ? Math.floor(cost / price) : 0;
    levels.push({
      level: (i + 1) as 1 | 2 | 3,
      qty,
      price,
      cost: qty * price,
      weightPct: weight * 100,
    });
  }
  return levels;
}

// --- RecoveryPlanBuilder: full ladder + new avg ---

export function computeNewAverage(
  shares: number,
  avgCost: number,
  ladder: RecoveryLadderLevel[]
): { newShares: number; newAvgCost: number } {
  let totalCost = shares * avgCost;
  let totalShares = shares;
  ladder.forEach(l => {
    totalCost += l.qty * l.price;
    totalShares += l.qty;
  });
  const newAvgCost = totalShares > 0 ? totalCost / totalShares : avgCost;
  return { newShares: totalShares, newAvgCost };
}

export function buildRecoveryLadder(
  currentPrice: number,
  totalBudget: number,
  riskTier: WealthUltraRiskTier,
  config: RecoveryGlobalConfig
): RecoveryLadderLevel[] {
  const prices = buildLadderPrices(currentPrice, riskTier, config);
  const cappedBudget = Math.min(
    totalBudget,
    config.deployableCash * config.recoveryBudgetPct
  );
  return allocateLadderQty(cappedBudget, prices, config.ladderWeights);
}

// --- ExitPlanGenerator ---

export function generateExitPlan(
  newAvgCost: number,
  exitParams: Partial<RecoveryExitPlan>,
  sleeveType: WealthUltraSleeve
): RecoveryExitPlan {
  const target1Pct = exitParams.target1Pct ?? (sleeveType === 'Core' ? 10 : sleeveType === 'Upside' ? 10 : 30);
  const target2Pct = exitParams.target2Pct ?? (sleeveType === 'Core' ? 20 : 25);
  const trailPct = exitParams.trailPct ?? (sleeveType === 'Core' ? 8 : sleeveType === 'Upside' ? 10 : 20);
  return {
    applyTarget1: exitParams.applyTarget1 ?? true,
    target1Pct,
    target1Price: exitParams.applyTarget1 !== false ? newAvgCost * (1 + target1Pct / 100) : undefined,
    applyTarget2: exitParams.applyTarget2 ?? false,
    target2Pct,
    target2Price: exitParams.applyTarget2 ? newAvgCost * (1 + target2Pct / 100) : undefined,
    applyTrailing: exitParams.applyTrailing ?? true,
    trailPct,
    trailStopPrice: exitParams.applyTrailing !== false ? newAvgCost * (1 - trailPct / 100) : undefined,
  };
}

// --- Full RecoveryPlanBuilder: one position → full result ---

export function buildRecoveryPlan(
  holding: Holding,
  currentPrice: number,
  positionConfig: RecoveryPositionConfig,
  config: RecoveryGlobalConfig,
  exitOverrides?: Partial<RecoveryExitPlan>
): RecoveryPlanResult {
  const metrics = positionMetrics(holding, currentPrice);
  const totalBudget = Math.min(
    positionConfig.cashCap,
    config.deployableCash * config.recoveryBudgetPct
  );
  const ladder = buildRecoveryLadder(
    currentPrice,
    totalBudget,
    positionConfig.riskTier,
    config
  );
  const totalPlannedCost = ladder.reduce((sum, l) => sum + l.cost, 0);
  const { newShares, newAvgCost } = computeNewAverage(
    holding.quantity,
    holding.avgCost,
    ladder
  );
  const exitPlan = generateExitPlan(
    newAvgCost,
    exitOverrides ?? {},
    positionConfig.sleeveType
  );
  const eligibility = qualifyRecovery(
    metrics.plPct,
    positionConfig,
    config,
    totalPlannedCost
  );
  const capCheck = violatesCaps(positionConfig, totalPlannedCost, config);

  let state: RecoveryPlanState = 'NORMAL';
  if (metrics.plPct > 0) state = 'NORMAL';
  else if (metrics.plPct > -positionConfig.lossTriggerPct) state = 'WATCH';
  else if (!eligibility.qualified) state = 'FROZEN';
  else state = 'QUALIFIED';

  return {
    symbol: holding.symbol,
    state,
    qualified: eligibility.qualified,
    reason: eligibility.reason,
    costBasis: metrics.costBasis,
    marketValue: metrics.marketValue,
    plUsd: metrics.plUsd,
    plPct: metrics.plPct,
    currentPrice,
    shares: holding.quantity,
    avgCost: holding.avgCost,
    ladder,
    totalPlannedCost,
    newShares,
    newAvgCost,
    exitPlan,
    budgetImpact: totalPlannedCost,
    capCheckOk: capCheck.ok,
  };
}

// --- FillReconciliationHandler: after a buy fill, recompute ---

export function reconcileAfterFill(
  previousShares: number,
  previousAvgCost: number,
  fillQty: number,
  fillPrice: number
): { newShares: number; newAvgCost: number } {
  const newShares = previousShares + fillQty;
  const totalCost = previousShares * previousAvgCost + fillQty * fillPrice;
  const newAvgCost = newShares > 0 ? totalCost / newShares : previousAvgCost;
  return { newShares, newAvgCost };
}

// --- OrderDraftGenerator: ladder + optional sell → draft orders ---

export function orderDraftGenerator(
  plan: RecoveryPlanResult,
  includeExits: boolean
): RecoveryOrderDraft[] {
  const drafts: RecoveryOrderDraft[] = [];
  plan.ladder.forEach(l => {
    if (l.qty > 0) {
      drafts.push({
        type: 'BUY',
        symbol: plan.symbol,
        qty: l.qty,
        limitPrice: l.price,
        orderType: 'LIMIT',
        label: `Recovery L${l.level}`,
      });
    }
  });
  if (includeExits && (plan.exitPlan.target1Price ?? plan.exitPlan.target2Price ?? plan.exitPlan.trailStopPrice)) {
    // Sell draft is informational; user executes separately
    drafts.push({
      type: 'SELL',
      symbol: plan.symbol,
      qty: plan.newShares,
      limitPrice: plan.exitPlan.target1Price ?? plan.newAvgCost,
      orderType: 'LIMIT',
      target1Price: plan.exitPlan.target1Price,
      target2Price: plan.exitPlan.target2Price,
      trailingStopPrice: plan.exitPlan.trailStopPrice,
      label: 'Recovery exit (reference)',
    });
  }
  return drafts;
}

// --- Resolve position config from holding + universe + defaults ---

export function defaultPositionConfig(
  symbol: string,
  sleeveType: WealthUltraSleeve,
  riskTier: WealthUltraRiskTier,
  cashCapOverride?: number
): RecoveryPositionConfig {
  const cashCap = cashCapOverride ?? 5000;
  const lossTriggerPct = 20;
  const recoveryEnabled = sleeveType !== 'Spec';
  return {
    symbol,
    recoveryEnabled,
    lossTriggerPct,
    cashCap,
    sleeveType,
    riskTier,
  };
}
