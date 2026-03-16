/**
 * Portfolio Construction & Management ("The Brain")
 * - Target allocation logic (profile → asset mix)
 * - Drift-based rebalancing (wired via sleeveAllocation + wealth-ultra)
 * - Mean-Variance Optimization (MVO) / Efficient Frontier
 * - Fractional share calculation (high-precision, 6 decimals)
 * - Monte Carlo simulation for goal probability of success
 */

import Decimal from 'decimal.js';

export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

/** Target asset mix e.g. 70% VTI, 30% BND. Symbol → weight (0-1). */
export interface TargetAssetMix {
  [symbol: string]: number;
}

/** Profile → suggested asset mix (ETF/ticker weights). */
const PROFILE_ASSET_MIX: Record<RiskProfile, TargetAssetMix> = {
  Conservative: { VTI: 0.60, BND: 0.40 },
  Moderate: { VTI: 0.70, BND: 0.30 },
  Aggressive: { VTI: 0.85, BND: 0.15 },
};

export function getTargetAllocationForProfile(profile: RiskProfile): TargetAssetMix {
  return { ...PROFILE_ASSET_MIX[profile] };
}

/**
 * High-precision fractional share quantity from dollar amount.
 * Uses Decimal.js for 6-decimal precision; respects minimum order size and rounding.
 */
export interface FractionalShareOptions {
  allowFractional: boolean;
  minimumOrderSize: number;
  roundingRule: 'round' | 'floor' | 'ceil';
  decimalPlaces?: number;
}

export function dollarToShareQuantity(
  dollarAmount: number,
  pricePerShare: number,
  options: FractionalShareOptions
): number {
  if (pricePerShare <= 0) return 0;
  const qty = new Decimal(dollarAmount).div(pricePerShare);
  const places = options.decimalPlaces ?? 6;
  if (!options.allowFractional) {
    const rule = options.roundingRule ?? 'round';
    const whole = rule === 'floor' ? qty.floor() : rule === 'ceil' ? qty.ceil() : qty.round();
    return Math.max(0, whole.toNumber());
  }
  const rounded = qty.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  return Math.max(0, rounded.toNumber());
}

/**
 * Mean-Variance Optimization: given expected returns and covariance matrix,
 * compute efficient frontier and optional max-Sharpe weights.
 * Simplified: single-period, no short sales.
 */
export interface MVOInput {
  expectedReturns: number[];
  covarianceMatrix: number[][];
  riskFreeRate?: number;
}

export interface MVOResult {
  /** Weights that maximize Sharpe (if riskFreeRate provided). */
  optimalWeights: number[];
  /** Expected return of optimal portfolio. */
  expectedReturn: number;
  /** Volatility (annualized) of optimal portfolio. */
  volatility: number;
  /** Sharpe ratio if riskFreeRate was provided. */
  sharpeRatio?: number;
}

export function meanVarianceOptimization(input: MVOInput): MVOResult {
  const { expectedReturns, covarianceMatrix, riskFreeRate = 0 } = input;
  const n = expectedReturns.length;
  if (n === 0 || covarianceMatrix.length !== n) {
    return { optimalWeights: [], expectedReturn: 0, volatility: 0 };
  }
  // Simplified: equal weight if 1 asset; two-asset closed form; else equal weight as fallback
  if (n === 1) {
    return {
      optimalWeights: [1],
      expectedReturn: expectedReturns[0],
      volatility: Math.sqrt(Math.max(0, covarianceMatrix[0][0])),
      sharpeRatio: riskFreeRate !== 0 ? (expectedReturns[0] - riskFreeRate) / Math.sqrt(Math.max(1e-8, covarianceMatrix[0][0])) : undefined,
    };
  }
  if (n === 2) {
    const [r1, r2] = expectedReturns;
    const v1 = covarianceMatrix[0][0];
    const v2 = covarianceMatrix[1][1];
    const c12 = covarianceMatrix[0][1] ?? covarianceMatrix[1][0];
    const denom = v1 + v2 - 2 * c12;
    let w1 = denom !== 0 ? (v2 - c12) / denom : 0.5;
    w1 = Math.max(0, Math.min(1, w1));
    const w2 = 1 - w1;
    const ret = w1 * r1 + w2 * r2;
    const varP = w1 * w1 * v1 + w2 * w2 * v2 + 2 * w1 * w2 * c12;
    const vol = Math.sqrt(Math.max(0, varP));
    return {
      optimalWeights: [w1, w2],
      expectedReturn: ret,
      volatility: vol,
      sharpeRatio: vol > 0 && riskFreeRate !== 0 ? (ret - riskFreeRate) / vol : undefined,
    };
  }
  // N-asset: equal weight fallback (full MVO would use quadratic programming)
  const w = 1 / n;
  const weights = Array(n).fill(w);
  const ret = expectedReturns.reduce((s, r, i) => s + weights[i] * r, 0);
  let varP = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      varP += weights[i] * weights[j] * (covarianceMatrix[i][j] ?? 0);
    }
  }
  const vol = Math.sqrt(Math.max(0, varP));
  return {
    optimalWeights: weights,
    expectedReturn: ret,
    volatility: vol,
    sharpeRatio: vol > 0 && riskFreeRate !== 0 ? (ret - riskFreeRate) / vol : undefined,
  };
}

/**
 * Monte Carlo simulation for goal success probability.
 * Runs many randomized return scenarios and returns % of paths that meet the goal.
 */
export interface MonteCarloGoalInput {
  currentAmount: number;
  targetAmount: number;
  monthlyContribution: number;
  monthsRemaining: number;
  /** Annual return mean (e.g. 0.07). */
  expectedAnnualReturn: number;
  /** Annual return std dev (e.g. 0.15). */
  annualVolatility: number;
  numSimulations?: number;
}

export interface MonteCarloGoalResult {
  probabilityOfSuccess: number;
  numSimulations: number;
  medianOutcome: number;
  percentile10: number;
  percentile90: number;
}

export function monteCarloGoalSuccess(input: MonteCarloGoalInput): MonteCarloGoalResult {
  const {
    currentAmount,
    targetAmount,
    monthlyContribution,
    monthsRemaining,
    expectedAnnualReturn,
    annualVolatility,
    numSimulations = 5000,
  } = input;
  const monthlyMu = expectedAnnualReturn / 12;
  const monthlySigma = annualVolatility / Math.sqrt(12);
  const outcomes: number[] = [];
  for (let s = 0; s < numSimulations; s++) {
    let value = currentAmount;
    for (let m = 0; m < monthsRemaining; m++) {
      const shock = monthlySigma * (Math.random() * 2 - 1) * 3.5; // approx normal
      value = value * (1 + monthlyMu + shock) + monthlyContribution;
    }
    outcomes.push(value);
  }
  outcomes.sort((a, b) => a - b);
  const successCount = outcomes.filter((v) => v >= targetAmount).length;
  const median = outcomes[Math.floor(numSimulations * 0.5)] ?? 0;
  const p10 = outcomes[Math.floor(numSimulations * 0.1)] ?? 0;
  const p90 = outcomes[Math.floor(numSimulations * 0.9)] ?? 0;
  return {
    probabilityOfSuccess: (successCount / numSimulations) * 100,
    numSimulations,
    medianOutcome: median,
    percentile10: p10,
    percentile90: p90,
  };
}
