/**
 * Enhanced Household Budget Engine
 * Dynamic baseline budgets, predictive spend, and cashflow stress signals
 */

import { Transaction } from '../types';

// Types for enhanced budget engine
export interface DynamicBaseline {
  category: string;
  baselineAmount: number;
  confidenceInterval: { lower: number; upper: number };
  trendDirection: 'increasing' | 'stable' | 'decreasing';
  trendStrength: number; // 0-1
  seasonalityFactor: number; // 0.5-1.5
  lastUpdated: Date;
}

export interface PredictiveSpend {
  category: string;
  predictedAmount: number;
  predictionInterval: { lower: number; upper: number };
  confidence: number; // 0-100
  factors: string[];
  riskOfOverrun: number; // 0-100
}

export interface CashflowStressSignal {
  type: 'warning' | 'critical' | 'opportunity';
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  timeframe: string;
  recommendedAction?: string;
  impactScore: number; // 0-100
}

export interface SpendingPattern {
  category: string;
  avgMonthlySpend: number;
  volatility: number;
  weekendSpendRatio: number;
  impulseSpendRatio: number;
  recurringVsDiscretionary: number; // 0-1
  merchantConcentration: number; // 0-1
  priceElasticity: number;
}

export interface BudgetHealthMetrics {
  adherenceScore: number; // 0-100
  forecastAccuracy: number; // 0-100
  stressResilience: number; // 0-100
  optimizationPotential: number; // 0-100
  behavioralRiskScore: number; // 0-100 (lower is better)
}

export interface SmartBudgetRecommendation {
  type: 'increase' | 'decrease' | 'reallocate' | 'monitor';
  category: string;
  currentBudget: number;
  recommendedBudget: number;
  rationale: string;
  expectedImpact: number;
  confidence: number;
}

/**
 * Calculate dynamic baseline budgets based on historical spending patterns
 */
export function calculateDynamicBaselines(
  transactions: Transaction[],
  _monthsOfHistory: number = 6
): DynamicBaseline[] {
  const categoryData: { [category: string]: number[] } = {};
  const categoryDates: { [category: string]: Date[] } = {};

  // Group transactions by category
  transactions.forEach(tx => {
    if (tx.type === 'expense') {
      const category = tx.budgetCategory || tx.category || 'Uncategorized';
      if (!categoryData[category]) {
        categoryData[category] = [];
        categoryDates[category] = [];
      }
      categoryData[category].push(Math.abs(tx.amount));
      categoryDates[category].push(new Date(tx.date));
    }
  });

  return Object.entries(categoryData).map(([category, amounts]) => {
    // Calculate statistics
    const sorted = [...amounts].sort((a, b) => a - b);
    // const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Calculate standard deviation
    // const variance = amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
    // const stdDev = Math.sqrt(variance); // Calculated but not used in current implementation
    
    // Detect trend
    const trend = detectTrend(amounts, categoryDates[category]);
    
    // Calculate seasonality
    const seasonality = calculateSeasonality(amounts, categoryDates[category]);
    
    // Confidence interval (using median ± 1.5 * MAD for robustness)
    const mad = calculateMAD(amounts, median);
    
    return {
      category,
      baselineAmount: median,
      confidenceInterval: {
        lower: Math.max(0, median - 1.5 * mad),
        upper: median + 1.5 * mad
      },
      trendDirection: trend.direction,
      trendStrength: trend.strength,
      seasonalityFactor: seasonality.factor,
      lastUpdated: new Date()
    };
  });
}

/**
 * Generate predictive spend forecasts
 */
export function generatePredictiveSpend(
  baselines: DynamicBaseline[],
  currentMonth: number,
  recentTransactions: Transaction[],
  upcomingBills: Array<{ category: string; amount: number; dueDate: Date }>
): PredictiveSpend[] {
  return baselines.map(baseline => {
    // Start with baseline
    let predicted = baseline.baselineAmount;
    const factors: string[] = [];
    
    // Adjust for trend
    if (baseline.trendDirection === 'increasing' && baseline.trendStrength > 0.3) {
      predicted *= 1 + (baseline.trendStrength * 0.1);
      factors.push('Upward spending trend');
    } else if (baseline.trendDirection === 'decreasing' && baseline.trendStrength > 0.3) {
      predicted *= 1 - (baseline.trendStrength * 0.05);
      factors.push('Downward spending trend');
    }
    
    // Adjust for seasonality
    const monthFactors = [1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.0, 1.0, 1.0, 1.0, 1.2, 1.3]; // Holiday spike
    predicted *= monthFactors[currentMonth - 1] || 1.0;
    if (monthFactors[currentMonth - 1] > 1.0) {
      factors.push('Seasonal spending pattern');
    }
    
    // Check for upcoming bills
    const upcomingBill = upcomingBills.find(b => b.category === baseline.category);
    if (upcomingBill) {
      predicted = Math.max(predicted, upcomingBill.amount);
      factors.push('Upcoming bill payment');
    }
    
    // Calculate confidence based on data quality
    const recentSpends = recentTransactions
      .filter(tx => tx.budgetCategory === baseline.category || tx.category === baseline.category)
      .filter(tx => tx.type === 'expense')
      .map(tx => Math.abs(tx.amount));
    
    const dataPoints = recentSpends.length;
    const confidence = Math.min(95, 30 + dataPoints * 10);
    
    // Calculate risk of budget overrun
    const budgetLimit = baseline.baselineAmount * 1.2; // Assume 20% buffer
    const riskOfOverrun = Math.max(0, Math.min(100, 
      ((predicted - budgetLimit) / budgetLimit) * 100 + 20
    ));
    
    return {
      category: baseline.category,
      predictedAmount: Math.round(predicted),
      predictionInterval: {
        lower: Math.round(predicted * 0.85),
        upper: Math.round(predicted * 1.15)
      },
      confidence,
      factors,
      riskOfOverrun: Math.round(riskOfOverrun)
    };
  });
}

/**
 * Generate cashflow stress signals
 */
export function generateCashflowStressSignals(
  currentBalance: number,
  predictedExpenses: number,
  upcomingIncome: number,
  recurringBills: number,
  emergencyFundTarget: number,
  daysUntilPayday: number
): CashflowStressSignal[] {
  const signals: CashflowStressSignal[] = [];
  
  // Signal 1: Low balance warning
  const minRequired = recurringBills + (predictedExpenses * 0.3);
  if (currentBalance < minRequired) {
    signals.push({
      type: 'critical',
      message: `Balance (${currentBalance.toFixed(0)}) below minimum required (${minRequired.toFixed(0)})`,
      metric: 'availableBalance',
      currentValue: currentBalance,
      threshold: minRequired,
      timeframe: 'immediate',
      recommendedAction: 'Defer non-essential spending or transfer from savings',
      impactScore: 85
    });
  } else if (currentBalance < minRequired * 1.3) {
    signals.push({
      type: 'warning',
      message: `Balance approaching minimum threshold`,
      metric: 'availableBalance',
      currentValue: currentBalance,
      threshold: minRequired,
      timeframe: `${daysUntilPayday} days until income`,
      recommendedAction: 'Monitor spending closely',
      impactScore: 60
    });
  }
  
  // Signal 2: Projected shortfall
  const projectedEndBalance = currentBalance - predictedExpenses + upcomingIncome;
  if (projectedEndBalance < 0) {
    signals.push({
      type: 'critical',
      message: `Projected shortfall of ${Math.abs(projectedEndBalance).toFixed(0)} this cycle`,
      metric: 'projectedBalance',
      currentValue: projectedEndBalance,
      threshold: 0,
      timeframe: 'this month',
      recommendedAction: 'Reduce discretionary spending or access credit line',
      impactScore: 90
    });
  }
  
  // Signal 3: Emergency fund drain risk
  if (currentBalance < emergencyFundTarget * 0.1 && emergencyFundTarget > 0) {
    signals.push({
      type: 'critical',
      message: 'Emergency fund critically low',
      metric: 'emergencyFundRatio',
      currentValue: currentBalance,
      threshold: emergencyFundTarget * 0.1,
      timeframe: 'immediate',
      recommendedAction: 'Prioritize rebuilding emergency fund',
      impactScore: 95
    });
  }
  
  // Signal 4: Opportunity signal (excess cash)
  const excessCash = currentBalance - minRequired - emergencyFundTarget * 0.2;
  if (excessCash > predictedExpenses * 0.5) {
    signals.push({
      type: 'opportunity',
      message: `Excess cash (${excessCash.toFixed(0)}) available for investment or debt repayment`,
      metric: 'excessCash',
      currentValue: excessCash,
      threshold: predictedExpenses * 0.5,
      timeframe: 'this month',
      recommendedAction: 'Consider investing excess or paying down debt',
      impactScore: 40
    });
  }
  
  // Signal 5: High spending velocity
  const daysInMonth = 30;
  const spendVelocity = (predictedExpenses / daysInMonth) * (daysInMonth - new Date().getDate());
  if (spendVelocity > currentBalance * 0.8 && daysUntilPayday > 7) {
    signals.push({
      type: 'warning',
      message: 'High spending velocity may exhaust funds before payday',
      metric: 'spendVelocity',
      currentValue: spendVelocity,
      threshold: currentBalance * 0.8,
      timeframe: `${daysUntilPayday} days`,
      recommendedAction: 'Slow discretionary spending',
      impactScore: 70
    });
  }
  
  return signals.sort((a, b) => b.impactScore - a.impactScore);
}

/**
 * Analyze detailed spending patterns
 */
export function analyzeSpendingPatterns(transactions: Transaction[]): SpendingPattern[] {
  const categoryGroups: { [category: string]: Transaction[] } = {};
  
  transactions.forEach(tx => {
    if (tx.type === 'expense') {
      const category = tx.budgetCategory || tx.category || 'Uncategorized';
      if (!categoryGroups[category]) {
        categoryGroups[category] = [];
      }
      categoryGroups[category].push(tx);
    }
  });
  
  return Object.entries(categoryGroups).map(([category, txs]) => {
    const amounts = txs.map(tx => Math.abs(tx.amount));
    const dates = txs.map(tx => new Date(tx.date));
    
    // Calculate basic stats
    const avgMonthly = amounts.reduce((sum, a) => sum + a, 0) / Math.max(1, amounts.length / 30);
    
    // Calculate volatility
    const variance = amounts.reduce((sum, a) => {
      const diff = a - avgMonthly;
      return sum + diff * diff;
    }, 0) / amounts.length;
    const volatility = Math.sqrt(variance);
    
    // Weekend spend ratio
    const weekendSpends = txs.filter(tx => {
      const day = new Date(tx.date).getDay();
      return day === 0 || day === 6;
    });
    const weekendRatio = weekendSpends.length / txs.length;
    
    // Impulse spend detection (unusual amounts, sporadic timing)
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const median = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    const mad = calculateMAD(amounts, median);
    const impulseTxs = txs.filter(tx => Math.abs(Math.abs(tx.amount) - median) > 2 * mad);
    const impulseRatio = impulseTxs.length / txs.length;
    
    // Recurring vs discretionary
    const recurringAmounts = identifyRecurringAmounts(amounts);
    const recurringVsDiscretionary = recurringAmounts / amounts.length;
    
    // Merchant concentration (simulate based on amount patterns)
    const uniqueAmounts = new Set(amounts.map(a => Math.round(a / 10) * 10)).size;
    const merchantConcentration = Math.min(1, uniqueAmounts / Math.max(1, amounts.length / 3));
    
    // Price elasticity estimate
    const priceElasticity = calculatePriceElasticity(amounts, dates);
    
    return {
      category,
      avgMonthlySpend: avgMonthly,
      volatility,
      weekendSpendRatio: weekendRatio,
      impulseSpendRatio: impulseRatio,
      recurringVsDiscretionary,
      merchantConcentration,
      priceElasticity
    };
  });
}

/**
 * Calculate comprehensive budget health metrics
 */
export function calculateBudgetHealthMetrics(
  budgets: Array<{ category: string; limit: number; spent: number }>,
  transactions: Transaction[],
  _monthsOfHistory: number = 3
): BudgetHealthMetrics {
  // Adherence score
  const adherenceScores = budgets.map(b => {
    if (b.spent <= b.limit) return 100;
    const overrun = (b.spent - b.limit) / b.limit;
    return Math.max(0, 100 - overrun * 100);
  });
  const adherenceScore = adherenceScores.reduce((sum, s) => sum + s, 0) / budgets.length;
  
  // Forecast accuracy
  const actualByCategory: { [category: string]: number } = {};
  transactions.forEach(tx => {
    if (tx.type === 'expense') {
      const cat = tx.budgetCategory || tx.category || 'Uncategorized';
      actualByCategory[cat] = (actualByCategory[cat] || 0) + Math.abs(tx.amount);
    }
  });
  
  let forecastErrors = 0;
  let forecastCount = 0;
  budgets.forEach(b => {
    const actual = actualByCategory[b.category] || 0;
    const error = Math.abs(b.limit - actual) / Math.max(b.limit, actual);
    forecastErrors += error;
    forecastCount++;
  });
  const forecastAccuracy = forecastCount > 0 
    ? Math.max(0, 100 - (forecastErrors / forecastCount) * 100)
    : 50;
  
  // Stress resilience
  const overruns = budgets.filter(b => b.spent > b.limit).length;
  const stressResilience = Math.max(0, 100 - (overruns / budgets.length) * 100);
  
  // Optimization potential
  const avgUtilization = budgets.reduce((sum, b) => sum + (b.spent / b.limit), 0) / budgets.length;
  const optimizationPotential = avgUtilization < 0.7 
    ? Math.round((0.7 - avgUtilization) * 100)
    : 10; // Low potential if already well-utilized
  
  // Behavioral risk score
  const patterns = analyzeSpendingPatterns(transactions);
  const behavioralRisks = patterns.map(p => 
    p.impulseSpendRatio * 30 + 
    p.volatility * 20 + 
    (1 - p.recurringVsDiscretionary) * 25
  );
  const behavioralRiskScore = behavioralRisks.reduce((sum, r) => sum + r, 0) / patterns.length;
  
  return {
    adherenceScore: Math.round(adherenceScore),
    forecastAccuracy: Math.round(forecastAccuracy),
    stressResilience: Math.round(stressResilience),
    optimizationPotential: Math.round(optimizationPotential),
    behavioralRiskScore: Math.round(behavioralRiskScore)
  };
}

/**
 * Generate smart budget recommendations
 */
export function generateSmartBudgetRecommendations(
  currentBudgets: Array<{ category: string; limit: number; spent: number }>,
  baselines: DynamicBaseline[],
  patterns: SpendingPattern[],
  _income: number
): SmartBudgetRecommendation[] {
  const recommendations: SmartBudgetRecommendation[] = [];
  
  currentBudgets.forEach(budget => {
    const baseline = baselines.find(b => b.category === budget.category);
    const pattern = patterns.find(p => p.category === budget.category);
    
    if (!baseline || !pattern) return;
    
    const utilization = budget.spent / budget.limit;
    
    // Case 1: Consistently under-spending
    if (utilization < 0.7 && baseline.trendDirection !== 'increasing') {
      const recommended = Math.round(budget.limit * 0.85);
      recommendations.push({
        type: 'decrease',
        category: budget.category,
        currentBudget: budget.limit,
        recommendedBudget: recommended,
        rationale: `Consistently under-spending (${(utilization * 100).toFixed(0)}% utilization). Reallocate to higher-priority categories.`,
        expectedImpact: Math.round(budget.limit - recommended),
        confidence: 80
      });
    }
    
    // Case 2: Consistently over-spending with increasing trend
    if (utilization > 1.1 && baseline.trendDirection === 'increasing') {
      const recommended = Math.round(Math.max(budget.spent, baseline.baselineAmount) * 1.1);
      recommendations.push({
        type: 'increase',
        category: budget.category,
        currentBudget: budget.limit,
        recommendedBudget: recommended,
        rationale: `Spending consistently exceeds budget with upward trend. Align budget with actual spending pattern.`,
        expectedImpact: -(recommended - budget.limit),
        confidence: 75
      });
    }
    
    // Case 3: High volatility - needs monitoring
    if (pattern.volatility > pattern.avgMonthlySpend * 0.5 && utilization > 0.9) {
      recommendations.push({
        type: 'monitor',
        category: budget.category,
        currentBudget: budget.limit,
        recommendedBudget: budget.limit,
        rationale: `High spending volatility detected. Monitor closely and consider splitting into sub-categories.`,
        expectedImpact: 0,
        confidence: 70
      });
    }
  });
  
  // Sort by confidence and expected impact
  return recommendations.sort((a, b) => 
    b.confidence * Math.abs(b.expectedImpact) - a.confidence * Math.abs(a.expectedImpact)
  );
}

// Helper functions
function detectTrend(amounts: number[], dates: Date[]): { direction: 'increasing' | 'stable' | 'decreasing'; strength: number } {
  if (amounts.length < 3) return { direction: 'stable', strength: 0 };
  
  // Simple linear regression
  const n = amounts.length;
  const sumX = dates.reduce((sum, _d, i) => sum + i, 0);
  const sumY = amounts.reduce((sum, a) => sum + a, 0);
  const sumXY = dates.reduce((sum, _d, i) => sum + i * amounts[i], 0);
  const sumX2 = dates.reduce((sum, _d, i) => sum + i * i, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avg = sumY / n;
  
  const strength = Math.min(1, Math.abs(slope) / (avg * 0.1));
  
  if (slope > avg * 0.02) return { direction: 'increasing', strength };
  if (slope < -avg * 0.02) return { direction: 'decreasing', strength };
  return { direction: 'stable', strength };
}

function calculateSeasonality(amounts: number[], dates: Date[]): { factor: number } {
  // Simplified seasonality based on month of year
  const monthSpends: number[][] = Array(12).fill(null).map(() => []);
  
  dates.forEach((date, i) => {
    monthSpends[date.getMonth()].push(amounts[i]);
  });
  
  const monthAvgs = monthSpends.map(spends => 
    spends.length > 0 ? spends.reduce((sum, s) => sum + s, 0) / spends.length : 0
  );
  
  const globalAvg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  const currentMonth = new Date().getMonth();
  const currentAvg = monthAvgs[currentMonth] || globalAvg;
  
  return { factor: globalAvg > 0 ? currentAvg / globalAvg : 1 };
}

function calculateMAD(values: number[], median: number): number {
  const deviations = values.map(v => Math.abs(v - median));
  const sortedDeviations = [...deviations].sort((a, b) => a - b);
  return sortedDeviations[Math.floor(sortedDeviations.length / 2)];
}

function identifyRecurringAmounts(amounts: number[]): number {
  const amountCounts: { [amount: number]: number } = {};
  amounts.forEach(a => {
    const rounded = Math.round(a / 10) * 10;
    amountCounts[rounded] = (amountCounts[rounded] || 0) + 1;
  });
  
  return Object.values(amountCounts).filter(c => c > 1).length;
}

function calculatePriceElasticity(amounts: number[], _dates: Date[]): number {
  // Simplified elasticity calculation
  if (amounts.length < 6) return 0.5; // Default
  
  const mid = Math.floor(amounts.length / 2);
  const firstHalf = amounts.slice(0, mid);
  const secondHalf = amounts.slice(mid);
  
  const avgFirst = firstHalf.reduce((sum, a) => sum + a, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, a) => sum + a, 0) / secondHalf.length;
  
  const pctChange = (avgSecond - avgFirst) / avgFirst;
  
  // Normalize to -1 to 1 scale
  return Math.max(-1, Math.min(1, pctChange * 5));
}
