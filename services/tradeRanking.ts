/**
 * Trade Ranking Algorithm
 * Multi-factor scoring system for ranking investment opportunities
 */

import { RiskMetrics } from './advancedRiskScoring';

export interface TradeCandidate {
  symbol: string;
  name?: string;
  currentPrice: number;
  sector: string;
  assetClass: string;
  
  // Fundamental metrics
  peRatio?: number;
  pbRatio?: number;
  epsGrowth?: number;
  revenueGrowth?: number;
  profitMargin?: number;
  roe?: number;
  debtToEquity?: number;
  
  // Technical metrics
  rsi14?: number;
  sma50?: number;
  sma200?: number;
  priceVsSMA50?: number; // % from 50-day SMA
  priceVsSMA200?: number; // % from 200-day SMA
  volumeAvg20?: number;
  volumeChange?: number; // % change from average
  volatility20?: number;
  
  // Market metrics
  marketCap?: number;
  beta?: number;
  dividendYield?: number;
  
  // Analyst metrics
  analystRating?: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  priceTarget?: number;
  upsidePotential?: number; // % to price target
  
  // ESG/Quality metrics
  esgScore?: number;
  qualityScore?: number;
}

export interface TradeScore {
  symbol: string;
  overallScore: number; // 0-100
  rank: number;
  
  // Component scores
  valueScore: number;     // 0-100
  growthScore: number;    // 0-100
  qualityScore: number;   // 0-100
  momentumScore: number;  // 0-100
  riskScore: number;      // 0-100 (lower is better, inverted)
  incomeScore: number;    // 0-100
  
  // Signal strength
  convictionLevel: 'weak' | 'moderate' | 'strong' | 'very_strong';
  signalDirection: 'bullish' | 'neutral' | 'bearish';
  
  // Trading recommendation
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' | 'avoid';
  suggestedPositionSize: number; // % of portfolio
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  
  // Analysis notes
  strengths: string[];
  concerns: string[];
}

export interface RankingWeights {
  value: number;
  growth: number;
  quality: number;
  momentum: number;
  risk: number;
  income: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  value: 0.20,
  growth: 0.20,
  quality: 0.15,
  momentum: 0.20,
  risk: 0.15,
  income: 0.10
};

export const CONSERVATIVE_WEIGHTS: RankingWeights = {
  value: 0.30,
  growth: 0.10,
  quality: 0.25,
  momentum: 0.10,
  risk: 0.20,
  income: 0.05
};

export const AGGRESSIVE_WEIGHTS: RankingWeights = {
  value: 0.10,
  growth: 0.30,
  quality: 0.10,
  momentum: 0.30,
  risk: 0.10,
  income: 0.10
};

export const INCOME_WEIGHTS: RankingWeights = {
  value: 0.20,
  growth: 0.10,
  quality: 0.20,
  momentum: 0.10,
  risk: 0.15,
  income: 0.25
};

/**
 * Calculate comprehensive trade score for a candidate
 */
export function calculateTradeScore(
  candidate: TradeCandidate,
  riskMetrics?: RiskMetrics,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS
): TradeScore {
  // Calculate component scores
  const valueScore = calculateValueScore(candidate);
  const growthScore = calculateGrowthScore(candidate);
  const qualityScore = calculateQualityScore(candidate);
  const momentumScore = calculateMomentumScore(candidate);
  const riskScore = calculateRiskScore(candidate, riskMetrics);
  const incomeScore = calculateIncomeScore(candidate);
  
  // Calculate weighted overall score
  const overallScore = 
    valueScore * weights.value +
    growthScore * weights.growth +
    qualityScore * weights.quality +
    momentumScore * weights.momentum +
    (100 - riskScore) * weights.risk + // Invert risk (lower risk = higher score)
    incomeScore * weights.income;
  
  // Determine conviction and signal
  const convictionLevel = scoreToConviction(overallScore);
  const signalDirection = determineSignalDirection(momentumScore, valueScore, riskScore);
  const recommendation = generateRecommendation(overallScore, riskScore, signalDirection);
  
  // Calculate suggested position size
  const suggestedPositionSize = calculateSuggestedPositionSize(
    overallScore,
    riskScore,
    convictionLevel
  );
  
  // Generate analysis notes
  const { strengths, concerns } = generateAnalysisNotes(candidate, {
    valueScore,
    growthScore,
    qualityScore,
    momentumScore,
    riskScore,
    incomeScore
  });
  
  return {
    symbol: candidate.symbol,
    overallScore: Math.round(overallScore * 10) / 10,
    rank: 0, // Set after sorting all candidates
    valueScore: Math.round(valueScore * 10) / 10,
    growthScore: Math.round(growthScore * 10) / 10,
    qualityScore: Math.round(qualityScore * 10) / 10,
    momentumScore: Math.round(momentumScore * 10) / 10,
    riskScore: Math.round(riskScore * 10) / 10,
    incomeScore: Math.round(incomeScore * 10) / 10,
    convictionLevel,
    signalDirection,
    recommendation,
    suggestedPositionSize,
    entryPrice: candidate.currentPrice,
    stopLoss: calculateStopLoss(candidate, riskMetrics),
    takeProfit: calculateTakeProfit(candidate),
    strengths,
    concerns
  };
}

/**
 * Rank multiple trade candidates
 */
export function rankTradeCandidates(
  candidates: TradeCandidate[],
  riskMetricsMap?: Map<string, RiskMetrics>,
  weights?: RankingWeights
): TradeScore[] {
  const scores = candidates.map(candidate => {
    const riskMetrics = riskMetricsMap?.get(candidate.symbol);
    return calculateTradeScore(candidate, riskMetrics, weights);
  });
  
  // Sort by overall score descending
  scores.sort((a, b) => b.overallScore - a.overallScore);
  
  // Assign ranks
  scores.forEach((score, index) => {
    score.rank = index + 1;
  });
  
  return scores;
}

/**
 * Filter and categorize ranked trades
 */
export function categorizeRankedTrades(scores: TradeScore[]): {
  strongBuys: TradeScore[];
  buys: TradeScore[];
  holds: TradeScore[];
  sells: TradeScore[];
  topPicks: TradeScore[];
  highRisk: TradeScore[];
  incomePlays: TradeScore[];
} {
  return {
    strongBuys: scores.filter(s => s.recommendation === 'strong_buy'),
    buys: scores.filter(s => s.recommendation === 'buy'),
    holds: scores.filter(s => s.recommendation === 'hold'),
    sells: scores.filter(s => s.recommendation === 'sell' || s.recommendation === 'strong_sell'),
    topPicks: scores.filter(s => s.overallScore >= 80 && s.riskScore < 50).slice(0, 10),
    highRisk: scores.filter(s => s.riskScore >= 60).sort((a, b) => b.overallScore - a.overallScore),
    incomePlays: scores.filter(s => s.incomeScore >= 70).sort((a, b) => b.incomeScore - a.incomeScore)
  };
}

/**
 * Calculate value score based on valuation metrics
 */
function calculateValueScore(candidate: TradeCandidate): number {
  let score = 50; // Neutral starting point
  
  // P/E ratio scoring (lower is better for value)
  if (candidate.peRatio !== undefined) {
    if (candidate.peRatio < 10) score += 20;
    else if (candidate.peRatio < 15) score += 15;
    else if (candidate.peRatio < 20) score += 10;
    else if (candidate.peRatio < 25) score += 5;
    else if (candidate.peRatio > 40) score -= 15;
    else if (candidate.peRatio > 30) score -= 10;
  }
  
  // P/B ratio scoring
  if (candidate.pbRatio !== undefined) {
    if (candidate.pbRatio < 1) score += 15;
    else if (candidate.pbRatio < 2) score += 10;
    else if (candidate.pbRatio < 3) score += 5;
    else if (candidate.pbRatio > 5) score -= 10;
  }
  
  // Price vs SMA (mean reversion opportunity)
  if (candidate.priceVsSMA200 !== undefined) {
    if (candidate.priceVsSMA200 < -20) score += 10; // Deep value opportunity
    else if (candidate.priceVsSMA200 < -10) score += 5;
    else if (candidate.priceVsSMA200 > 30) score -= 10; // Extended
  }
  
  // Upside potential from analyst targets
  if (candidate.upsidePotential !== undefined) {
    if (candidate.upsidePotential > 30) score += 10;
    else if (candidate.upsidePotential > 20) score += 7;
    else if (candidate.upsidePotential > 10) score += 4;
    else if (candidate.upsidePotential < -10) score -= 10;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate growth score based on growth metrics
 */
function calculateGrowthScore(candidate: TradeCandidate): number {
  let score = 50;
  
  // EPS growth
  if (candidate.epsGrowth !== undefined) {
    if (candidate.epsGrowth > 30) score += 20;
    else if (candidate.epsGrowth > 20) score += 15;
    else if (candidate.epsGrowth > 15) score += 12;
    else if (candidate.epsGrowth > 10) score += 8;
    else if (candidate.epsGrowth > 5) score += 4;
    else if (candidate.epsGrowth < -10) score -= 15;
    else if (candidate.epsGrowth < 0) score -= 10;
  }
  
  // Revenue growth
  if (candidate.revenueGrowth !== undefined) {
    if (candidate.revenueGrowth > 25) score += 15;
    else if (candidate.revenueGrowth > 15) score += 10;
    else if (candidate.revenueGrowth > 10) score += 6;
    else if (candidate.revenueGrowth < -5) score -= 10;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate quality score based on profitability and financial health
 */
function calculateQualityScore(candidate: TradeCandidate): number {
  let score = 50;
  
  // ROE
  if (candidate.roe !== undefined) {
    if (candidate.roe > 20) score += 15;
    else if (candidate.roe > 15) score += 12;
    else if (candidate.roe > 12) score += 8;
    else if (candidate.roe > 8) score += 4;
    else if (candidate.roe < 5) score -= 10;
  }
  
  // Profit margin
  if (candidate.profitMargin !== undefined) {
    if (candidate.profitMargin > 25) score += 15;
    else if (candidate.profitMargin > 15) score += 10;
    else if (candidate.profitMargin > 10) score += 6;
    else if (candidate.profitMargin < 5) score -= 10;
  }
  
  // Debt to equity (lower is better)
  if (candidate.debtToEquity !== undefined) {
    if (candidate.debtToEquity < 0.3) score += 10;
    else if (candidate.debtToEquity < 0.5) score += 5;
    else if (candidate.debtToEquity > 1.5) score -= 10;
    else if (candidate.debtToEquity > 1.0) score -= 5;
  }
  
  // ESG score if available
  if (candidate.esgScore !== undefined) {
    score += (candidate.esgScore - 50) / 5; // +/- 10 points
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate momentum score based on technical indicators
 */
function calculateMomentumScore(candidate: TradeCandidate): number {
  let score = 50;
  
  // Price vs 50-day SMA
  if (candidate.priceVsSMA50 !== undefined) {
    if (candidate.priceVsSMA50 > 10) score += 10;
    else if (candidate.priceVsSMA50 > 5) score += 7;
    else if (candidate.priceVsSMA50 > 0) score += 3;
    else if (candidate.priceVsSMA50 < -10) score -= 10;
  }
  
  // Price vs 200-day SMA
  if (candidate.priceVsSMA200 !== undefined) {
    if (candidate.priceVsSMA200 > 20) score += 10;
    else if (candidate.priceVsSMA200 > 10) score += 7;
    else if (candidate.priceVsSMA200 > 0) score += 3;
    else if (candidate.priceVsSMA200 < -20) score -= 10;
  }
  
  // RSI (avoid extremes)
  if (candidate.rsi14 !== undefined) {
    if (candidate.rsi14 > 70) score -= 10; // Overbought
    else if (candidate.rsi14 > 60) score += 5;
    else if (candidate.rsi14 > 50) score += 10;
    else if (candidate.rsi14 > 40) score += 7;
    else if (candidate.rsi14 < 30) score -= 5; // Oversold (potential reversal)
  }
  
  // Volume confirmation
  if (candidate.volumeChange !== undefined) {
    if (candidate.volumeChange > 50) score += 5; // High interest
    else if (candidate.volumeChange < -30) score -= 3; // Low interest
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate risk score (lower is better)
 */
function calculateRiskScore(candidate: TradeCandidate, riskMetrics?: RiskMetrics): number {
  let score = 50;
  
  // Use risk metrics if available
  if (riskMetrics) {
    score = riskMetrics.overallRiskScore;
  } else {
    // Estimate from available data
    
    // Beta
    if (candidate.beta !== undefined) {
      if (candidate.beta > 1.5) score += 20;
      else if (candidate.beta > 1.2) score += 10;
      else if (candidate.beta < 0.8) score -= 10;
    }
    
    // Volatility
    if (candidate.volatility20 !== undefined) {
      if (candidate.volatility20 > 0.50) score += 15;
      else if (candidate.volatility20 > 0.30) score += 10;
      else if (candidate.volatility20 < 0.15) score -= 10;
    }
    
    // Market cap (larger = less risky generally)
    if (candidate.marketCap !== undefined) {
      if (candidate.marketCap > 100e9) score -= 10; // Large cap
      else if (candidate.marketCap < 2e9) score += 10; // Small cap
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate income score for dividend/income investors
 */
function calculateIncomeScore(candidate: TradeCandidate): number {
  let score = 50;
  
  // Dividend yield
  if (candidate.dividendYield !== undefined) {
    if (candidate.dividendYield > 5) score += 25;
    else if (candidate.dividendYield > 4) score += 20;
    else if (candidate.dividendYield > 3) score += 15;
    else if (candidate.dividendYield > 2) score += 10;
    else if (candidate.dividendYield > 1) score += 5;
    else if (candidate.dividendYield === 0) score -= 10;
  } else {
    score -= 15; // No dividend
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Convert score to conviction level
 */
function scoreToConviction(score: number): 'weak' | 'moderate' | 'strong' | 'very_strong' {
  if (score >= 85) return 'very_strong';
  if (score >= 70) return 'strong';
  if (score >= 55) return 'moderate';
  return 'weak';
}

/**
 * Determine signal direction
 */
function determineSignalDirection(
  momentumScore: number,
  valueScore: number,
  riskScore: number
): 'bullish' | 'neutral' | 'bearish' {
  const signal = momentumScore * 0.4 + valueScore * 0.3 - riskScore * 0.3;
  
  if (signal > 60) return 'bullish';
  if (signal < 40) return 'bearish';
  return 'neutral';
}

/**
 * Generate trading recommendation
 */
function generateRecommendation(
  overallScore: number,
  riskScore: number,
  signalDirection: 'bullish' | 'neutral' | 'bearish'
): TradeScore['recommendation'] {
  if (signalDirection === 'bullish') {
    if (overallScore >= 80 && riskScore < 40) return 'strong_buy';
    if (overallScore >= 65) return 'buy';
  } else if (signalDirection === 'bearish') {
    if (overallScore < 40) return 'strong_sell';
    if (overallScore < 50) return 'sell';
  }
  
  if (overallScore < 30) return 'avoid';
  return 'hold';
}

/**
 * Calculate suggested position size based on score and risk
 */
function calculateSuggestedPositionSize(
  overallScore: number,
  riskScore: number,
  conviction: TradeScore['convictionLevel']
): number {
  // Base size by conviction
  const baseSizes = {
    weak: 0.01,
    moderate: 0.03,
    strong: 0.05,
    very_strong: 0.08
  };
  
  let size = baseSizes[conviction];
  
  // Adjust for score
  if (overallScore > 90) size *= 1.3;
  else if (overallScore < 50) size *= 0.5;
  
  // Adjust for risk (reduce size for high risk)
  if (riskScore > 70) size *= 0.5;
  else if (riskScore > 50) size *= 0.75;
  
  // Cap at 10%
  return Math.min(0.10, size);
}

/**
 * Calculate stop loss based on volatility
 */
function calculateStopLoss(
  candidate: TradeCandidate,
  riskMetrics?: RiskMetrics
): number | undefined {
  if (!candidate.currentPrice) return undefined;
  
  let stopDistance = 0.08; // Default 8%
  
  if (riskMetrics) {
    // Adjust based on volatility
    stopDistance = Math.min(0.15, Math.max(0.05, riskMetrics.volatility * 0.5));
  } else if (candidate.volatility20 !== undefined) {
    stopDistance = Math.min(0.15, Math.max(0.05, candidate.volatility20 * 1.5));
  }
  
  return candidate.currentPrice * (1 - stopDistance);
}

/**
 * Calculate take profit target
 */
function calculateTakeProfit(candidate: TradeCandidate): number | undefined {
  if (!candidate.currentPrice) return undefined;
  
  // Use analyst target if available
  if (candidate.priceTarget && candidate.priceTarget > candidate.currentPrice) {
    return candidate.priceTarget;
  }
  
  // Default 15-25% based on momentum
  let targetPct = 0.15;
  if (candidate.priceVsSMA50 && candidate.priceVsSMA50 > 10) {
    targetPct = 0.25; // Strong momentum, higher target
  }
  
  return candidate.currentPrice * (1 + targetPct);
}

/**
 * Generate analysis notes
 */
function generateAnalysisNotes(
  candidate: TradeCandidate,
  scores: {
    valueScore: number;
    growthScore: number;
    qualityScore: number;
    momentumScore: number;
    riskScore: number;
    incomeScore: number;
  }
): { strengths: string[]; concerns: string[] } {
  const strengths: string[] = [];
  const concerns: string[] = [];
  
  // Value analysis
  if (scores.valueScore >= 70) {
    strengths.push('Attractive valuation metrics');
    if (candidate.peRatio && candidate.peRatio < 15) {
      strengths.push(`Low P/E ratio (${candidate.peRatio.toFixed(1)}x)`);
    }
    if (candidate.upsidePotential && candidate.upsidePotential > 20) {
      strengths.push(`Significant upside potential (${candidate.upsidePotential.toFixed(1)}%)`);
    }
  } else if (scores.valueScore < 40) {
    concerns.push('Valuation appears stretched');
  }
  
  // Growth analysis
  if (scores.growthScore >= 70) {
    strengths.push('Strong growth trajectory');
    if (candidate.epsGrowth && candidate.epsGrowth > 20) {
      strengths.push(`Robust EPS growth (${candidate.epsGrowth.toFixed(1)}%)`);
    }
  } else if (scores.growthScore < 40) {
    concerns.push('Growth momentum slowing');
  }
  
  // Quality analysis
  if (scores.qualityScore >= 70) {
    strengths.push('High quality business fundamentals');
    if (candidate.roe && candidate.roe > 15) {
      strengths.push(`Excellent ROE (${candidate.roe.toFixed(1)}%)`);
    }
  }
  
  // Momentum analysis
  if (scores.momentumScore >= 70) {
    strengths.push('Positive price momentum');
    if (candidate.priceVsSMA50 && candidate.priceVsSMA50 > 5) {
      strengths.push(`Trading above 50-day moving average (+${candidate.priceVsSMA50.toFixed(1)}%)`);
    }
  } else if (scores.momentumScore < 40) {
    concerns.push('Weak price momentum');
  }
  
  // Risk analysis
  if (scores.riskScore < 40) {
    strengths.push('Lower risk profile');
  } else if (scores.riskScore >= 60) {
    concerns.push('Higher risk profile');
    if (candidate.beta && candidate.beta > 1.3) {
      concerns.push(`High beta (${candidate.beta.toFixed(2)}) indicates volatility`);
    }
  }
  
  // Income analysis
  if (scores.incomeScore >= 70) {
    strengths.push('Attractive income potential');
    if (candidate.dividendYield && candidate.dividendYield > 3) {
      strengths.push(`Strong dividend yield (${candidate.dividendYield.toFixed(2)}%)`);
    }
  }
  
  return { strengths, concerns };
}

/**
 * Generate top picks report
 */
export function generateTopPicksReport(scores: TradeScore[]): {
  summary: string;
  topPick: TradeScore | null;
  runnersUp: TradeScore[];
  themes: string[];
} {
  const topPick = scores.length > 0 ? scores[0] : null;
  const runnersUp = scores.slice(1, 6);
  
  // Identify themes
  const themes: string[] = [];
  const avgValue = scores.reduce((sum, s) => sum + s.valueScore, 0) / scores.length;
  const avgGrowth = scores.reduce((sum, s) => sum + s.growthScore, 0) / scores.length;
  const avgMomentum = scores.reduce((sum, s) => sum + s.momentumScore, 0) / scores.length;
  const avgIncome = scores.reduce((sum, s) => sum + s.incomeScore, 0) / scores.length;
  
  if (avgValue > 65) themes.push('Value opportunities available');
  if (avgGrowth > 65) themes.push('Growth stocks leading');
  if (avgMomentum > 65) themes.push('Momentum driving markets');
  if (avgIncome > 65) themes.push('Income plays in focus');
  
  const summary = topPick
    ? `Top pick: ${topPick.symbol} with score ${topPick.overallScore}/100 (${topPick.convictionLevel} conviction)`
    : 'No qualified candidates found';
  
  return { summary, topPick, runnersUp, themes };
}
