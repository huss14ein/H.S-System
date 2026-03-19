/**
 * Sleeve-Aware Allocation Logic
 * Intelligent allocation across Core/Upside/Speculative sleeves with risk-adjusted weighting
 */

import { RiskMetrics } from './advancedRiskScoring';

export interface SleeveAllocation {
  core: {
    targetPct: number;
    currentPct: number;
    positions: SleevePosition[];
    riskScore: number;
    volatility: number;
  };
  upside: {
    targetPct: number;
    currentPct: number;
    positions: SleevePosition[];
    riskScore: number;
    volatility: number;
  };
  speculative: {
    targetPct: number;
    currentPct: number;
    positions: SleevePosition[];
    riskScore: number;
    volatility: number;
  };
}

export interface SleevePosition {
  symbol: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
  sleeve: 'core' | 'upside' | 'speculative';
  riskMetrics: RiskMetrics;
  convictionScore: number; // 0-100 based on analysis
  momentumScore: number;   // 0-100 based on recent performance
  fundamentalScore: number; // 0-100 based on fundamentals
}

export interface RebalanceAction {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  shares: number;
  reason: string;
  priority: number;
  expectedImpact: {
    sleeve: 'core' | 'upside' | 'speculative';
    riskChange: number;
    returnPotential: number;
  };
}

export interface RebalancePolicy {
  driftTolerance: number;        // % drift before rebalancing (default: 5%)
  maxTurnover: number;          // Max % of portfolio to trade (default: 20%)
  minTradeSize: number;          // Min trade in currency (default: 1000)
  taxEfficiency: boolean;        // Prefer low-turnover / fee-efficient sleeves (legacy flag name)
  cashBuffer: number;           // Keep this % in cash (default: 5%)
  maxPositionSize: number;      // Max % in single position (default: 25%)
  rebalanceFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'threshold';
  lastRebalanceDate?: Date;
  nextScheduledRebalance?: Date;
}

/**
 * Calculate optimal sleeve allocation based on risk tolerance and market conditions
 */
export function calculateOptimalSleeveAllocation(
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive',
  marketVolatility: number, // Current market VIX or similar
  timeHorizon: number // Years
): { core: number; upside: number; speculative: number } {
  // Base allocations by risk tolerance
  const baseAllocations = {
    Conservative: { core: 0.70, upside: 0.25, speculative: 0.05 },
    Moderate: { core: 0.50, upside: 0.35, speculative: 0.15 },
    Aggressive: { core: 0.30, upside: 0.40, speculative: 0.30 }
  };

  let allocation = { ...baseAllocations[riskTolerance] };

  // Adjust for market volatility (high vol = more core)
  if (marketVolatility > 30) {
    allocation.core = Math.min(0.80, allocation.core + 0.10);
    allocation.speculative = Math.max(0.05, allocation.speculative - 0.05);
  } else if (marketVolatility < 15) {
    allocation.speculative = Math.min(0.35, allocation.speculative + 0.05);
  }

  // Adjust for time horizon (longer = more upside/speculative)
  if (timeHorizon > 10) {
    allocation.upside = Math.min(0.50, allocation.upside + 0.05);
  } else if (timeHorizon < 3) {
    allocation.core = Math.min(0.80, allocation.core + 0.10);
    allocation.speculative = Math.max(0.05, allocation.speculative - 0.05);
  }

  // Normalize to ensure sums to 100%
  const total = allocation.core + allocation.upside + allocation.speculative;
  return {
    core: allocation.core / total,
    upside: allocation.upside / total,
    speculative: allocation.speculative / total
  };
}

/**
 * Classify positions into sleeves based on risk metrics and characteristics
 */
export function classifyPositionsIntoSleeves(
  positions: SleevePosition[],
  overrides?: { [symbol: string]: 'core' | 'upside' | 'speculative' }
): SleeveAllocation {
  const classified: SleeveAllocation = {
    core: { targetPct: 0, currentPct: 0, positions: [], riskScore: 0, volatility: 0 },
    upside: { targetPct: 0, currentPct: 0, positions: [], riskScore: 0, volatility: 0 },
    speculative: { targetPct: 0, currentPct: 0, positions: [], riskScore: 0, volatility: 0 }
  };

  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);

  positions.forEach(position => {
    // Check for override first
    if (overrides?.[position.symbol]) {
      position.sleeve = overrides[position.symbol];
    } else {
      // Auto-classify based on risk metrics
      const volatility = position.riskMetrics.volatility;
      const riskScore = position.riskMetrics.overallRiskScore;

      if (volatility < 0.20 && riskScore < 40) {
        position.sleeve = 'core';
      } else if (volatility < 0.35 && riskScore < 65) {
        position.sleeve = 'upside';
      } else {
        position.sleeve = 'speculative';
      }
    }

    // Add to appropriate sleeve
    const sleeve = classified[position.sleeve];
    sleeve.positions.push(position);
    sleeve.currentPct += position.marketValue / totalValue;
    sleeve.riskScore += position.riskMetrics.overallRiskScore;
    sleeve.volatility += position.riskMetrics.volatility;
  });

  // Calculate averages
  ['core', 'upside', 'speculative'].forEach(key => {
    const sleeve = classified[key as keyof SleeveAllocation];
    if (sleeve.positions.length > 0) {
      sleeve.riskScore /= sleeve.positions.length;
      sleeve.volatility /= sleeve.positions.length;
    }
  });

  return classified;
}

/**
 * Calculate rebalance actions to achieve target sleeve allocation
 */
export function calculateSleeveRebalanceActions(
  currentAllocation: SleeveAllocation,
  targetAllocation: { core: number; upside: number; speculative: number },
  policy: RebalancePolicy,
  totalPortfolioValue: number
): RebalanceAction[] {
  const actions: RebalanceAction[] = [];

  // Calculate sleeve-level adjustments needed
  const sleeveAdjustments = {
    core: targetAllocation.core - currentAllocation.core.currentPct,
    upside: targetAllocation.upside - currentAllocation.upside.currentPct,
    speculative: targetAllocation.speculative - currentAllocation.speculative.currentPct
  };

  // Check if rebalancing needed
  const needsRebalance =
    Math.abs(sleeveAdjustments.core) > policy.driftTolerance / 100 ||
    Math.abs(sleeveAdjustments.upside) > policy.driftTolerance / 100 ||
    Math.abs(sleeveAdjustments.speculative) > policy.driftTolerance / 100;

  if (!needsRebalance) {
    return [];
  }

  // Prioritize underweight sleeves that need to increase
  const sortedSleeves = Object.entries(sleeveAdjustments)
    .sort((a, b) => b[1] - a[1]) // Most underweight first
    .map(([sleeve]) => sleeve as 'core' | 'upside' | 'speculative');

  // Generate buy actions for underweight sleeves
  sortedSleeves.forEach(sleeve => {
    const adjustment = sleeveAdjustments[sleeve];
    if (adjustment > 0) {
      // Need to buy more in this sleeve
      const targetValue = adjustment * totalPortfolioValue;
      const positions = currentAllocation[sleeve].positions;

      if (positions.length > 0) {
        // Distribute buys across best positions in sleeve
        const sortedPositions = [...positions].sort((a, b) =>
          (b.convictionScore + b.momentumScore) - (a.convictionScore + a.momentumScore)
        );

        let remainingToBuy = targetValue;

        sortedPositions.forEach(position => {
          if (remainingToBuy < policy.minTradeSize) return;

          const maxPositionSize = policy.maxPositionSize * totalPortfolioValue;
          const currentPositionValue = position.marketValue;
          const maxAdditional = maxPositionSize - currentPositionValue;

          if (maxAdditional > policy.minTradeSize) {
            const buyAmount = Math.min(remainingToBuy, maxAdditional);
            const shares = Math.floor(buyAmount / position.currentPrice);

            if (shares > 0) {
              actions.push({
                symbol: position.symbol,
                action: 'buy',
                shares,
                reason: `${sleeve} sleeve underweight (${(adjustment * 100).toFixed(1)}%). High conviction (${position.convictionScore}/100)`,
                priority: Math.floor(adjustment * 100) + position.convictionScore,
                expectedImpact: {
                  sleeve,
                  riskChange: position.riskMetrics.overallRiskScore / 100,
                  returnPotential: position.momentumScore / 100
                }
              });

              remainingToBuy -= shares * position.currentPrice;
            }
          }
        });
      }
    }
  });

  // Generate sell actions for overweight sleeves (reverse order)
  [...sortedSleeves].reverse().forEach(sleeve => {
    const adjustment = sleeveAdjustments[sleeve];
    if (adjustment < 0) {
      // Need to sell from this sleeve
      const targetSellValue = Math.abs(adjustment) * totalPortfolioValue;
      const positions = currentAllocation[sleeve].positions;

      if (positions.length > 0) {
        // Sell from lowest conviction positions first
        const sortedPositions = [...positions].sort((a, b) =>
          a.convictionScore - b.convictionScore
        );

        let remainingToSell = targetSellValue;

        sortedPositions.forEach(position => {
          if (remainingToSell < policy.minTradeSize) return;

          // Keep at least 1 share or min position size
          const minPositionValue = 0.02 * totalPortfolioValue; // 2% min
          const minSharesToKeep = Math.ceil(minPositionValue / position.currentPrice);
          const maxSharesToSell = position.shares - minSharesToKeep;

          if (maxSharesToSell > 0) {
            const maxSellValue = Math.min(remainingToSell, maxSharesToSell * position.currentPrice);
            const shares = Math.floor(maxSellValue / position.currentPrice);

            if (shares > 0) {
              actions.push({
                symbol: position.symbol,
                action: 'sell',
                shares,
                reason: `${sleeve} sleeve overweight (${(Math.abs(adjustment) * 100).toFixed(1)}%). Lower conviction (${position.convictionScore}/100)`,
                priority: Math.floor(Math.abs(adjustment) * 100) + (100 - position.convictionScore),
                expectedImpact: {
                  sleeve,
                  riskChange: -position.riskMetrics.overallRiskScore / 200, // Risk reduction
                  returnPotential: 0
                }
              });

              remainingToSell -= shares * position.currentPrice;
            }
          }
        });
      }
    }
  });

  // Sort by priority (higher = execute first)
  return actions.sort((a, b) => b.priority - a.priority);
}

/**
 * Check if rebalancing is needed based on policy and current state
 */
export function isRebalancingNeeded(
  currentAllocation: SleeveAllocation,
  targetAllocation: { core: number; upside: number; speculative: number },
  policy: RebalancePolicy
): { needed: boolean; reason: string; urgency: 'low' | 'medium' | 'high' } {
  const now = new Date();

  // Check scheduled rebalance
  if (policy.nextScheduledRebalance && now >= policy.nextScheduledRebalance) {
    return { needed: true, reason: 'Scheduled rebalance due', urgency: 'medium' };
  }

  // Check threshold-based rebalance
  const drift = {
    core: Math.abs(currentAllocation.core.currentPct - targetAllocation.core),
    upside: Math.abs(currentAllocation.upside.currentPct - targetAllocation.upside),
    speculative: Math.abs(currentAllocation.speculative.currentPct - targetAllocation.speculative)
  };

  const maxDrift = Math.max(drift.core, drift.upside, drift.speculative);
  const tolerance = policy.driftTolerance / 100;

  if (maxDrift > tolerance * 2) {
    return { needed: true, reason: `Severe sleeve drift: ${(maxDrift * 100).toFixed(1)}%`, urgency: 'high' };
  } else if (maxDrift > tolerance) {
    return { needed: true, reason: `Moderate sleeve drift: ${(maxDrift * 100).toFixed(1)}%`, urgency: 'medium' };
  }

  // Check position concentration
  const allPositions = [
    ...currentAllocation.core.positions,
    ...currentAllocation.upside.positions,
    ...currentAllocation.speculative.positions
  ];

  const maxPositionPct = Math.max(...allPositions.map(p => p.marketValue));
  if (maxPositionPct > policy.maxPositionSize) {
    return { needed: true, reason: `Position exceeds ${policy.maxPositionSize}% limit`, urgency: 'high' };
  }

  return { needed: false, reason: 'Within tolerance', urgency: 'low' };
}

/**
 * Calculate risk-adjusted sleeve weights
 */
export function calculateRiskAdjustedSleeveWeights(
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive',
  currentVolatility: number,
  maxAcceptableVolatility: number
): { core: number; upside: number; speculative: number; leverage: number } {
  // Base weights
  const base = calculateOptimalSleeveAllocation(riskTolerance, currentVolatility, 5);

  // Calculate required leverage/volatility adjustment
  const volatilityRatio = maxAcceptableVolatility / Math.max(currentVolatility, 0.10);
  const leverage = Math.min(1.5, Math.max(0.5, volatilityRatio));

  // Adjust weights based on leverage
  if (leverage > 1) {
    // Can take more risk
    base.speculative = Math.min(0.40, base.speculative * leverage);
    base.core = Math.max(0.30, base.core / leverage);
  } else {
    // Need to reduce risk
    base.speculative = base.speculative * leverage;
    base.core = Math.min(0.80, base.core + (1 - leverage) * 0.15);
  }

  // Normalize
  const total = base.core + base.upside + base.speculative;
  return {
    core: base.core / total,
    upside: base.upside / total,
    speculative: base.speculative / total,
    leverage
  };
}

/**
 * Generate sleeve drift report
 */
export function generateSleeveDriftReport(
  current: SleeveAllocation,
  target: { core: number; upside: number; speculative: number },
  historicalDrift?: { date: Date; core: number; upside: number; speculative: number }[]
): {
  summary: string;
  driftAnalysis: {
    sleeve: string;
    target: number;
    current: number;
    drift: number;
    trend: 'improving' | 'stable' | 'worsening';
  }[];
  recommendations: string[];
} {
  const driftAnalysis: {
    sleeve: string;
    target: number;
    current: number;
    drift: number;
    trend: 'improving' | 'stable' | 'worsening';
  }[] = [
    {
      sleeve: 'Core',
      target: target.core,
      current: current.core.currentPct,
      drift: current.core.currentPct - target.core,
      trend: 'stable' as const
    },
    {
      sleeve: 'Upside',
      target: target.upside,
      current: current.upside.currentPct,
      drift: current.upside.currentPct - target.upside,
      trend: 'stable' as const
    },
    {
      sleeve: 'Speculative',
      target: target.speculative,
      current: current.speculative.currentPct,
      drift: current.speculative.currentPct - target.speculative,
      trend: 'stable' as const
    }
  ];

  // Analyze trend if historical data available
  if (historicalDrift && historicalDrift.length > 1) {
    const recent = historicalDrift.slice(-3);
    driftAnalysis.forEach(sleeve => {
      const sleeveKey = sleeve.sleeve.toLowerCase() as 'core' | 'upside' | 'speculative';
      const values = recent.map(h => h[sleeveKey]);
      const trend = values[values.length - 1] - values[0];

      if (Math.abs(trend) < 0.02) sleeve.trend = 'stable';
      else if (sleeve.drift > 0 && trend > 0) sleeve.trend = 'worsening';
      else if (sleeve.drift < 0 && trend < 0) sleeve.trend = 'worsening';
      else sleeve.trend = 'improving';
    });
  }

  // Generate recommendations
  const recommendations: string[] = [];

  driftAnalysis.forEach(sleeve => {
    const driftPct = Math.abs(sleeve.drift) * 100;
    if (driftPct > 10) {
      const action = sleeve.drift > 0 ? 'reduce' : 'increase';
      recommendations.push(`${action.charAt(0).toUpperCase() + action.slice(1)} ${sleeve.sleeve.toLowerCase()} allocation by ${driftPct.toFixed(1)}%`);
    }
  });

  const summary = driftAnalysis.every(d => Math.abs(d.drift) < 0.05)
    ? 'Sleeve allocation within target ranges'
    : `Significant drift detected: ${driftAnalysis.filter(d => Math.abs(d.drift) > 0.05).map(d => d.sleeve).join(', ')}`;

  return { summary, driftAnalysis, recommendations };
}
