/**
 * Advanced Investment Risk Scoring System
 * Comprehensive risk metrics for portfolio analysis and position sizing
 */

export interface RiskMetrics {
  // Volatility measures
  volatility: number;              // Standard deviation of returns
  beta: number;                    // Market correlation
  alpha: number;                   // Excess return vs benchmark
  
  // Drawdown measures
  maxDrawdown: number;             // Maximum peak-to-trough decline
  currentDrawdown: number;         // Current drawdown from peak
  
  // Tail risk measures
  var95: number;                   // Value at Risk (95% confidence)
  var99: number;                   // Value at Risk (99% confidence)
  cvar95: number;                  // Conditional VaR (Expected Shortfall)
  
  // Risk-adjusted returns
  sharpeRatio: number;             // Return per unit of total risk
  sortinoRatio: number;            // Return per unit of downside risk
  treynorRatio: number;            // Return per unit of systematic risk
  calmarRatio: number;             // Return per unit of max drawdown
  
  // Position-specific risk
  concentrationRisk: number;      // % of portfolio in single position
  liquidityRisk: number;           // Based on average volume and position size
  correlationRisk: number;        // Average correlation with other holdings
  
  // Composite scores
  overallRiskScore: number;         // 0-100 composite risk score
  riskRating: 'Low' | 'Moderate' | 'High' | 'Extreme';
  sleeveRiskScore: number;        // Risk score adjusted for sleeve allocation
}

export interface PositionRiskInput {
  symbol: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
  avgCost: number;
  sector: string;
  assetClass: string;
  
  // Historical data (optional, calculated if not provided)
  priceHistory?: number[];         // Daily closing prices
  returns?: number[];              // Daily returns
  volumeHistory?: number[];        // Daily trading volumes
}

export interface PortfolioRiskInput {
  positions: PositionRiskInput[];
  cashBalance: number;
  totalPortfolioValue: number;
  
  // Benchmark data
  benchmarkReturns?: number[];     // S&P 500 or relevant benchmark
  riskFreeRate?: number;         // Current risk-free rate (default: 0.05)
  
  // Risk tolerance settings
  maxPositionSize?: number;        // Max % of portfolio in single position (default: 0.25)
  maxSectorExposure?: number;      // Max % in single sector (default: 0.30)
}

/**
 * Calculate comprehensive risk metrics for a position
 */
export function calculatePositionRisk(
  position: PositionRiskInput,
  portfolioValue: number,
  otherPositions: PositionRiskInput[]
): RiskMetrics {
  const marketValue = position.shares * position.currentPrice;
  const concentrationRisk = marketValue / portfolioValue;
  
  // Calculate returns if price history provided
  const returns = position.returns || 
    (position.priceHistory ? calculateReturns(position.priceHistory) : []);
  
  // Volatility calculation
  const volatility = returns.length > 1 
    ? calculateStandardDeviation(returns) * Math.sqrt(252) // Annualized
    : 0.25; // Default 25% volatility for new positions
  
  // Calculate VaR
  const var95 = calculateVaR(returns, 0.95, marketValue);
  const var99 = calculateVaR(returns, 0.99, marketValue);
  const cvar95 = calculateCVaR(returns, 0.95, marketValue);
  
  // Calculate drawdowns
  const { maxDrawdown, currentDrawdown } = position.priceHistory 
    ? calculateDrawdowns(position.priceHistory, position.avgCost)
    : { maxDrawdown: 0, currentDrawdown: 0 };
  
  // Liquidity risk based on position size vs typical volume
  const liquidityRisk = calculateLiquidityRisk(position, marketValue);
  
  // Calculate correlations with other positions
  const correlationRisk = calculateCorrelationRisk(position, otherPositions);
  
  // Risk-adjusted return metrics
  const sharpeRatio = calculateSharpeRatio(returns);
  const sortinoRatio = calculateSortinoRatio(returns);
  const calmarRatio = calculateCalmarRatio(returns, maxDrawdown);
  
  // Calculate composite risk score (0-100)
  const overallRiskScore = calculateCompositeRiskScore({
    volatility,
    maxDrawdown,
    var95,
    concentrationRisk,
    liquidityRisk,
    correlationRisk,
    sharpeRatio
  });
  
  return {
    volatility,
    beta: 0, // Will be calculated at portfolio level
    alpha: 0, // Will be calculated at portfolio level
    maxDrawdown,
    currentDrawdown,
    var95,
    var99,
    cvar95,
    sharpeRatio,
    sortinoRatio,
    treynorRatio: 0, // Requires beta
    calmarRatio,
    concentrationRisk,
    liquidityRisk,
    correlationRisk,
    overallRiskScore,
    riskRating: scoreToRating(overallRiskScore),
    sleeveRiskScore: 0 // Calculated at sleeve level
  };
}

/**
 * Calculate portfolio-level risk metrics
 */
export function calculatePortfolioRisk(
  portfolio: PortfolioRiskInput
): { portfolioMetrics: RiskMetrics; positionMetrics: Map<string, RiskMetrics> } {
  const { positions, totalPortfolioValue, benchmarkReturns, riskFreeRate = 0.05 } = portfolio;
  
  const positionMetrics = new Map<string, RiskMetrics>();
  
  // Calculate position-level metrics
  positions.forEach(position => {
    const otherPositions = positions.filter(p => p.symbol !== position.symbol);
    const metrics = calculatePositionRisk(position, totalPortfolioValue, otherPositions);
    positionMetrics.set(position.symbol, metrics);
  });
  
  // Calculate portfolio returns as weighted average
  const portfolioReturns = calculatePortfolioReturns(positions);
  
  // Portfolio volatility
  const volatility = portfolioReturns.length > 1
    ? calculateStandardDeviation(portfolioReturns) * Math.sqrt(252)
    : 0.20;
  
  // Portfolio VaR
  const var95 = calculateVaR(portfolioReturns, 0.95, totalPortfolioValue);
  const var99 = calculateVaR(portfolioReturns, 0.99, totalPortfolioValue);
  const cvar95 = calculateCVaR(portfolioReturns, 0.95, totalPortfolioValue);
  
  // Calculate portfolio max drawdown
  const portfolioPrices = calculatePortfolioValueSeries(positions);
  const { maxDrawdown } = calculateDrawdownsFromSeries(portfolioPrices);
  
  // Calculate beta and alpha if benchmark provided
  let beta = 0;
  let alpha = 0;
  
  if (benchmarkReturns && benchmarkReturns.length > 0) {
    beta = calculateBeta(portfolioReturns, benchmarkReturns);
    alpha = calculateAlpha(portfolioReturns, benchmarkReturns, riskFreeRate, beta);
  }
  
  // Risk-adjusted returns
  const sharpeRatio = calculateSharpeRatio(portfolioReturns, riskFreeRate);
  const sortinoRatio = calculateSortinoRatio(portfolioReturns, riskFreeRate);
  const treynorRatio = beta > 0 ? (calculateAnnualizedReturn(portfolioReturns) - riskFreeRate) / beta : 0;
  const calmarRatio = calculateCalmarRatio(portfolioReturns, maxDrawdown);
  
  // Calculate concentration metrics
  const largestPosition = Math.max(...positions.map(p => 
    (p.shares * p.currentPrice) / totalPortfolioValue
  ));
  
  const sectorConcentration = calculateSectorConcentration(positions, totalPortfolioValue);
  
  // Composite risk score
  const overallRiskScore = calculateCompositeRiskScore({
    volatility,
    maxDrawdown,
    var95,
    concentrationRisk: largestPosition,
    liquidityRisk: 0, // Averaged at portfolio level
    correlationRisk: 0, // Averaged at portfolio level
    sharpeRatio
  });
  
  const portfolioMetrics: RiskMetrics = {
    volatility,
    beta,
    alpha,
    maxDrawdown,
    currentDrawdown: 0,
    var95,
    var99,
    cvar95,
    sharpeRatio,
    sortinoRatio,
    treynorRatio,
    calmarRatio,
    concentrationRisk: largestPosition,
    liquidityRisk: 0,
    correlationRisk: sectorConcentration,
    overallRiskScore,
    riskRating: scoreToRating(overallRiskScore),
    sleeveRiskScore: 0
  };
  
  return { portfolioMetrics, positionMetrics };
}

/**
 * Calculate risk-adjusted position size limits
 */
export function calculatePositionSizeLimits(
  riskMetrics: RiskMetrics,
  portfolioValue: number,
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive' = 'Moderate'
): {
  maxPositionSize: number;
  recommendedPositionSize: number;
  riskAdjustedPositionSize: number;
  warningThreshold: number;
} {
  // Base limits by risk tolerance
  const baseLimits = {
    Conservative: { max: 0.10, warning: 0.08 },
    Moderate: { max: 0.20, warning: 0.15 },
    Aggressive: { max: 0.30, warning: 0.25 }
  };
  
  const limits = baseLimits[riskTolerance];
  
  // Adjust based on risk score (higher risk = lower position size)
  const riskMultiplier = Math.max(0.3, 1 - (riskMetrics.overallRiskScore / 100));
  
  const riskAdjustedPositionSize = limits.max * riskMultiplier * portfolioValue;
  const recommendedPositionSize = limits.warning * riskMultiplier * portfolioValue;
  const maxPositionSize = limits.max * portfolioValue;
  const warningThreshold = limits.warning * portfolioValue;
  
  return {
    maxPositionSize,
    recommendedPositionSize,
    riskAdjustedPositionSize,
    warningThreshold
  };
}

/**
 * Calculate sleeve-aware risk allocation
 */
export function calculateSleeveRiskAllocation(
  positions: PositionRiskInput[],
  sleeveTargets: { core: number; upside: number; speculative: number }
): {
  coreAllocation: { positions: string[]; riskScore: number; targetMet: boolean };
  upsideAllocation: { positions: string[]; riskScore: number; targetMet: boolean };
  speculativeAllocation: { positions: string[]; riskScore: number; targetMet: boolean };
  overallSleeveRisk: number;
  rebalancingNeeded: boolean;
} {
  // Classify positions by risk level into sleeves
  const classifiedPositions = positions.map(pos => {
    const volatility = pos.returns 
      ? calculateStandardDeviation(pos.returns) * Math.sqrt(252)
      : 0.30;
    
    let sleeve: 'core' | 'upside' | 'speculative';
    if (volatility < 0.20) sleeve = 'core';
    else if (volatility < 0.35) sleeve = 'upside';
    else sleeve = 'speculative';
    
    return { ...pos, volatility, sleeve };
  });
  
  const totalValue = positions.reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
  
  // Calculate current allocations
  const coreValue = classifiedPositions
    .filter(p => p.sleeve === 'core')
    .reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
  
  const upsideValue = classifiedPositions
    .filter(p => p.sleeve === 'upside')
    .reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
  
  const speculativeValue = classifiedPositions
    .filter(p => p.sleeve === 'speculative')
    .reduce((sum, p) => sum + p.shares * p.currentPrice, 0);
  
  const currentCorePct = coreValue / totalValue;
  const currentUpsidePct = upsideValue / totalValue;
  const currentSpeculativePct = speculativeValue / totalValue;
  
  // Calculate risk scores per sleeve
  const coreRisk = calculateSleeveRisk(classifiedPositions.filter(p => p.sleeve === 'core'));
  const upsideRisk = calculateSleeveRisk(classifiedPositions.filter(p => p.sleeve === 'upside'));
  const speculativeRisk = calculateSleeveRisk(classifiedPositions.filter(p => p.sleeve === 'speculative'));
  
  // Check if rebalancing needed (allow 5% tolerance)
  const tolerance = 0.05;
  const rebalancingNeeded = 
    Math.abs(currentCorePct - sleeveTargets.core) > tolerance ||
    Math.abs(currentUpsidePct - sleeveTargets.upside) > tolerance ||
    Math.abs(currentSpeculativePct - sleeveTargets.speculative) > tolerance;
  
  return {
    coreAllocation: {
      positions: classifiedPositions.filter(p => p.sleeve === 'core').map(p => p.symbol),
      riskScore: coreRisk,
      targetMet: Math.abs(currentCorePct - sleeveTargets.core) <= tolerance
    },
    upsideAllocation: {
      positions: classifiedPositions.filter(p => p.sleeve === 'upside').map(p => p.symbol),
      riskScore: upsideRisk,
      targetMet: Math.abs(currentUpsidePct - sleeveTargets.upside) <= tolerance
    },
    speculativeAllocation: {
      positions: classifiedPositions.filter(p => p.sleeve === 'speculative').map(p => p.symbol),
      riskScore: speculativeRisk,
      targetMet: Math.abs(currentSpeculativePct - sleeveTargets.speculative) <= tolerance
    },
    overallSleeveRisk: (coreRisk + upsideRisk + speculativeRisk) / 3,
    rebalancingNeeded
  };
}

// Helper functions
function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  return returns;
}

function calculateStandardDeviation(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

function calculateVaR(returns: number[], confidence: number, portfolioValue: number): number {
  if (returns.length === 0) return portfolioValue * 0.02; // Default 2%
  
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sortedReturns.length);
  return Math.abs(sortedReturns[index] || sortedReturns[0]) * portfolioValue;
}

function calculateCVaR(returns: number[], confidence: number, portfolioValue: number): number {
  if (returns.length === 0) return portfolioValue * 0.03; // Default 3%
  
  const var_ = calculateVaR(returns, confidence, 1); // Calculate as %
  const tailReturns = returns.filter(r => r <= -var_);
  
  if (tailReturns.length === 0) return var_ * portfolioValue;
  
  const avgTailReturn = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
  return Math.abs(avgTailReturn) * portfolioValue;
}

function calculateDrawdowns(prices: number[], initialCost: number): { maxDrawdown: number; currentDrawdown: number } {
  if (prices.length === 0) return { maxDrawdown: 0, currentDrawdown: 0 };
  
  let peak = initialCost;
  let maxDrawdown = 0;
  
  for (const price of prices) {
    if (price > peak) peak = price;
    const drawdown = (peak - price) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  const currentPrice = prices[prices.length - 1];
  const currentDrawdown = peak > 0 ? (peak - currentPrice) / peak : 0;
  
  return { maxDrawdown, currentDrawdown };
}

function calculateDrawdownsFromSeries(values: number[]): { maxDrawdown: number } {
  if (values.length === 0) return { maxDrawdown: 0 };
  
  let peak = values[0];
  let maxDrawdown = 0;
  
  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  return { maxDrawdown };
}

function calculateLiquidityRisk(position: PositionRiskInput, marketValue: number): number {
  if (!position.volumeHistory || position.volumeHistory.length === 0) {
    return 0.5; // Medium risk if no volume data
  }
  
  const avgVolume = position.volumeHistory.reduce((sum, v) => sum + v, 0) / position.volumeHistory.length;
  const positionSizeVsVolume = marketValue / (avgVolume * position.currentPrice);
  
  // Higher ratio = higher liquidity risk
  return Math.min(1, positionSizeVsVolume / 10);
}

function calculateCorrelationRisk(position: PositionRiskInput, otherPositions: PositionRiskInput[]): number {
  if (!position.returns || position.returns.length === 0) return 0.5;
  if (otherPositions.length === 0) return 0;
  
  const correlations = otherPositions
    .filter(p => p.returns && p.returns.length > 0)
    .map(p => calculateCorrelation(position.returns!, p.returns!));
  
  if (correlations.length === 0) return 0.5;
  
  const avgCorrelation = correlations.reduce((sum, c) => sum + c, 0) / correlations.length;
  return avgCorrelation; // 0 = diversified, 1 = highly correlated
}

function calculateCorrelation(returns1: number[], returns2: number[]): number {
  const n = Math.min(returns1.length, returns2.length);
  if (n < 2) return 0;
  
  const mean1 = returns1.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
  const mean2 = returns2.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
  
  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;
  
  for (let i = 0; i < n; i++) {
    const diff1 = returns1[i] - mean1;
    const diff2 = returns2[i] - mean2;
    numerator += diff1 * diff2;
    denom1 += diff1 * diff1;
    denom2 += diff2 * diff2;
  }
  
  const denominator = Math.sqrt(denom1 * denom2);
  return denominator === 0 ? 0 : numerator / denominator;
}

function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.05): number {
  if (returns.length < 2) return 0;
  
  const annualizedReturn = calculateAnnualizedReturn(returns);
  const volatility = calculateStandardDeviation(returns) * Math.sqrt(252);
  
  return volatility === 0 ? 0 : (annualizedReturn - riskFreeRate) / volatility;
}

function calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.05): number {
  if (returns.length < 2) return 0;
  
  const annualizedReturn = calculateAnnualizedReturn(returns);
  const downsideReturns = returns.filter(r => r < 0);
  const downsideDeviation = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length) * Math.sqrt(252)
    : 0;
  
  return downsideDeviation === 0 ? 0 : (annualizedReturn - riskFreeRate) / downsideDeviation;
}

function calculateCalmarRatio(returns: number[], maxDrawdown: number): number {
  if (returns.length === 0 || maxDrawdown === 0) return 0;
  
  const annualizedReturn = calculateAnnualizedReturn(returns);
  return annualizedReturn / maxDrawdown;
}

function calculateAnnualizedReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  
  const totalReturn = returns.reduce((product, r) => product * (1 + r), 1) - 1;
  const periodsPerYear = 252; // Trading days
  const years = returns.length / periodsPerYear;
  
  return years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;
}

function calculateBeta(stockReturns: number[], marketReturns: number[]): number {
  const covariance = calculateCovariance(stockReturns, marketReturns);
  const marketVariance = calculateVariance(marketReturns);
  
  return marketVariance === 0 ? 1 : covariance / marketVariance;
}

function calculateAlpha(
  stockReturns: number[],
  marketReturns: number[],
  riskFreeRate: number,
  beta: number
): number {
  const stockReturn = calculateAnnualizedReturn(stockReturns);
  const marketReturn = calculateAnnualizedReturn(marketReturns);
  
  return stockReturn - (riskFreeRate + beta * (marketReturn - riskFreeRate));
}

function calculateCovariance(returns1: number[], returns2: number[]): number {
  const n = Math.min(returns1.length, returns2.length);
  if (n < 2) return 0;
  
  const mean1 = returns1.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
  const mean2 = returns2.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
  
  let covariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (returns1[i] - mean1) * (returns2[i] - mean2);
  }
  
  return covariance / n;
}

function calculateVariance(returns: number[]): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  return returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
}

function calculatePortfolioReturns(positions: PositionRiskInput[]): number[] {
  // Simplified: use equal-weighted returns
  const allReturns: number[][] = positions
    .filter(p => p.returns && p.returns.length > 0)
    .map(p => p.returns!);
  
  if (allReturns.length === 0) return [];
  
  const minLength = Math.min(...allReturns.map(r => r.length));
  const portfolioReturns: number[] = [];
  
  for (let i = 0; i < minLength; i++) {
    const dayReturn = allReturns.reduce((sum, returns) => sum + returns[i], 0) / allReturns.length;
    portfolioReturns.push(dayReturn);
  }
  
  return portfolioReturns;
}

function calculatePortfolioValueSeries(positions: PositionRiskInput[]): number[] {
  // Simplified portfolio value calculation
  if (positions.length === 0 || !positions[0].priceHistory) return [];
  
  const minLength = Math.min(...positions
    .filter(p => p.priceHistory)
    .map(p => p.priceHistory!.length)
  );
  
  const values: number[] = [];
  
  for (let i = 0; i < minLength; i++) {
    let dailyValue = 0;
    positions.forEach(p => {
      if (p.priceHistory && p.priceHistory[i]) {
        dailyValue += p.shares * p.priceHistory[i];
      }
    });
    values.push(dailyValue);
  }
  
  return values;
}

function calculateSectorConcentration(positions: PositionRiskInput[], totalValue: number): number {
  const sectorValues: { [key: string]: number } = {};
  
  positions.forEach(p => {
    const value = p.shares * p.currentPrice;
    sectorValues[p.sector] = (sectorValues[p.sector] || 0) + value;
  });
  
  const sectorPcts = Object.values(sectorValues).map(v => v / totalValue);
  return Math.max(...sectorPcts);
}

function calculateSleeveRisk(positions: (PositionRiskInput & { volatility: number })[]): number {
  if (positions.length === 0) return 0;
  
  const avgVolatility = positions.reduce((sum, p) => sum + p.volatility, 0) / positions.length;
  return Math.min(100, avgVolatility * 200); // Scale to 0-100
}

interface RiskScoreInputs {
  volatility: number;
  maxDrawdown: number;
  var95: number;
  concentrationRisk: number;
  liquidityRisk: number;
  correlationRisk: number;
  sharpeRatio: number;
}

function calculateCompositeRiskScore(inputs: RiskScoreInputs): number {
  const weights = {
    volatility: 0.25,
    maxDrawdown: 0.20,
    var95: 0.20,
    concentrationRisk: 0.15,
    liquidityRisk: 0.10,
    correlationRisk: 0.05,
    sharpeRatio: 0.05
  };
  
  // Normalize inputs to 0-100 scale
  const normalized = {
    volatility: Math.min(100, inputs.volatility * 200), // 50% vol = 100 score
    maxDrawdown: Math.min(100, inputs.maxDrawdown * 100), // 100% drawdown = 100 score
    var95: Math.min(100, inputs.var95 * 100), // VaR as % of portfolio
    concentrationRisk: Math.min(100, inputs.concentrationRisk * 100), // 100% concentration = 100 score
    liquidityRisk: Math.min(100, inputs.liquidityRisk * 100),
    correlationRisk: Math.min(100, inputs.correlationRisk * 100),
    sharpeRatio: Math.max(0, Math.min(100, 100 - inputs.sharpeRatio * 20)) // Invert: higher Sharpe = lower risk
  };
  
  const score = 
    normalized.volatility * weights.volatility +
    normalized.maxDrawdown * weights.maxDrawdown +
    normalized.var95 * weights.var95 +
    normalized.concentrationRisk * weights.concentrationRisk +
    normalized.liquidityRisk * weights.liquidityRisk +
    normalized.correlationRisk * weights.correlationRisk +
    normalized.sharpeRatio * weights.sharpeRatio;
  
  return Math.min(100, Math.max(0, score));
}

function scoreToRating(score: number): 'Low' | 'Moderate' | 'High' | 'Extreme' {
  if (score < 30) return 'Low';
  if (score < 60) return 'Moderate';
  if (score < 80) return 'High';
  return 'Extreme';
}
