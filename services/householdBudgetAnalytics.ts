/**
 * Household Budget Engine Analytics & Predictive Service
 * Provides predictive analytics, scenario planning, and trend analysis
 */

import type { HouseholdMonthPlan, HouseholdEngineResult } from './householdBudgetEngine';

export interface SpendingTrend {
  month: number;
  category: string;
  amount: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  changePct: number;
}

export interface PredictiveForecast {
  month: number;
  predictedIncome: number;
  predictedExpense: number;
  predictedNet: number;
  confidence: 'high' | 'medium' | 'low';
  factors: string[];
}

export interface ScenarioAnalysis {
  name: string;
  description: string;
  monthlySalaryChange: number;
  monthlyExpenseChange: number;
  projectedYearEndBalance: number;
  projectedYearEndBalanceChange: number;
  goalAchievementImpact: {
    goalName: string;
    achievementDelayMonths: number;
  }[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface BudgetAnomaly {
  month: number;
  category: string;
  expectedAmount: number;
  actualAmount: number;
  deviation: number;
  deviationPct: number;
  severity: 'low' | 'medium' | 'high';
  explanation: string;
}

/**
 * Analyze spending trends across months
 */
export function analyzeSpendingTrends(
  months: HouseholdMonthPlan[],
  category: string
): SpendingTrend[] {
  const trends: SpendingTrend[] = [];
  const categoryKey = category.toLowerCase().replace(/\s+/g, '');
  
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1];
    const curr = months[i];
    
    // Get category amount from buckets (simplified - would need proper mapping)
    const prevAmount = (prev.buckets as any)[categoryKey] || 0;
    const currAmount = (curr.buckets as any)[categoryKey] || 0;
    
    if (prevAmount > 0) {
      const changePct = ((currAmount - prevAmount) / prevAmount) * 100;
      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (changePct > 5) trend = 'increasing';
      else if (changePct < -5) trend = 'decreasing';
      
      trends.push({
        month: curr.month,
        category,
        amount: currAmount,
        trend,
        changePct,
      });
    }
  }
  
  return trends;
}

/**
 * Predict future income/expense based on historical patterns
 */
export function predictFutureMonths(
  months: HouseholdMonthPlan[],
  forecastMonths: number = 3
): PredictiveForecast[] {
  const forecasts: PredictiveForecast[] = [];
  
  if (months.length < 3) return forecasts;
  
  // Calculate averages and trends from last 3 months
  const recentMonths = months.slice(-3);
  const avgIncome = recentMonths.reduce((sum, m) => sum + m.incomeActual, 0) / recentMonths.length;
  const avgExpense = recentMonths.reduce((sum, m) => sum + m.totalActualOutflow, 0) / recentMonths.length;
  
  // Calculate trend
  const incomeTrend = recentMonths.length >= 2
    ? (recentMonths[recentMonths.length - 1].incomeActual - recentMonths[0].incomeActual) / recentMonths.length
    : 0;
  const expenseTrend = recentMonths.length >= 2
    ? (recentMonths[recentMonths.length - 1].totalActualOutflow - recentMonths[0].totalActualOutflow) / recentMonths.length
    : 0;
  
  // Calculate variance for confidence
  const incomeVariance = recentMonths.reduce((sum, m) => {
    const diff = m.incomeActual - avgIncome;
    return sum + (diff * diff);
  }, 0) / recentMonths.length;
  const incomeStdDev = Math.sqrt(incomeVariance);
  const incomeCv = avgIncome > 0 ? incomeStdDev / avgIncome : 0;
  
  const confidence: 'high' | 'medium' | 'low' = incomeCv < 0.1 ? 'high' : incomeCv < 0.25 ? 'medium' : 'low';
  
  for (let i = 1; i <= forecastMonths; i++) {
    const predictedIncome = avgIncome + (incomeTrend * i);
    const predictedExpense = avgExpense + (expenseTrend * i);
    const predictedNet = predictedIncome - predictedExpense;
    
    const factors: string[] = [];
    if (Math.abs(incomeTrend) > avgIncome * 0.05) {
      factors.push(incomeTrend > 0 ? 'Increasing income trend' : 'Decreasing income trend');
    }
    if (Math.abs(expenseTrend) > avgExpense * 0.05) {
      factors.push(expenseTrend > 0 ? 'Increasing expense trend' : 'Decreasing expense trend');
    }
    if (incomeCv > 0.25) {
      factors.push('High income variability');
    }
    
    forecasts.push({
      month: months.length + i,
      predictedIncome: Math.max(0, predictedIncome),
      predictedExpense: Math.max(0, predictedExpense),
      predictedNet,
      confidence,
      factors,
    });
  }
  
  return forecasts;
}

/**
 * Analyze scenario: what if salary changes or expenses change
 */
export function analyzeScenario(
  result: HouseholdEngineResult,
  monthlySalaryChange: number,
  monthlyExpenseChange: number,
  goals: Array<{ name: string; remaining: number }>
): ScenarioAnalysis {
  const currentYearEndBalance = result.balanceProjection.projectedYearEndLiquid;
  const avgMonthlySalary = result.months.reduce((sum, m) => sum + m.incomePlanned, 0) / result.months.length;
  const avgMonthlyExpense = result.months.reduce((sum, m) => sum + m.totalPlannedOutflow, 0) / result.months.length;
  
  const newAvgSalary = avgMonthlySalary + monthlySalaryChange;
  const newAvgExpense = avgMonthlyExpense + monthlyExpenseChange;
  const newMonthlyNet = newAvgSalary - newAvgExpense;
  
  const projectedYearEndBalance = result.balanceProjection.openingLiquid + (newMonthlyNet * 12);
  const projectedYearEndBalanceChange = projectedYearEndBalance - currentYearEndBalance;
  
  // Calculate goal achievement impact
  const goalAchievementImpact = goals.map(goal => {
    const currentSurplus = result.months.reduce((sum, m) => sum + (m.routedGoalAmount + m.buckets.goalSavings), 0);
    const newSurplus = Math.max(0, newMonthlyNet * 12);
    const currentMonthsToGoal = currentSurplus > 0 ? goal.remaining / (currentSurplus / 12) : 999;
    const newMonthsToGoal = newSurplus > 0 ? goal.remaining / (newSurplus / 12) : 999;
    const delayMonths = newMonthsToGoal - currentMonthsToGoal;
    
    return {
      goalName: goal.name,
      achievementDelayMonths: delayMonths,
    };
  });
  
  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (newMonthlyNet < 0) riskLevel = 'high';
  else if (newMonthlyNet < avgMonthlySalary * 0.1) riskLevel = 'medium';
  
  const description = monthlySalaryChange !== 0 || monthlyExpenseChange !== 0
    ? `Scenario: ${monthlySalaryChange >= 0 ? '+' : ''}${monthlySalaryChange.toLocaleString()} salary change, ${monthlyExpenseChange >= 0 ? '+' : ''}${monthlyExpenseChange.toLocaleString()} expense change`
    : 'Baseline scenario';
  
  return {
    name: `${monthlySalaryChange >= 0 ? '+' : ''}${monthlySalaryChange.toLocaleString()} Salary / ${monthlyExpenseChange >= 0 ? '+' : ''}${monthlyExpenseChange.toLocaleString()} Expense`,
    description,
    monthlySalaryChange,
    monthlyExpenseChange,
    projectedYearEndBalance,
    projectedYearEndBalanceChange,
    goalAchievementImpact,
    riskLevel,
  };
}

/**
 * Detect anomalies in spending patterns
 */
export function detectAnomalies(
  months: HouseholdMonthPlan[]
): BudgetAnomaly[] {
  const anomalies: BudgetAnomaly[] = [];
  
  if (months.length < 3) return anomalies;
  
  // Calculate expected amounts based on historical average
  const categoryAverages: Record<string, number> = {};
  const categoryStdDevs: Record<string, number> = {};
  
  // Group by category (simplified - would need proper category mapping)
  const categoryKeys = Object.keys(months[0].buckets);
  
  categoryKeys.forEach(key => {
    const amounts = months.map(m => (m.buckets as any)[key] || 0);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    
    categoryAverages[key] = avg;
    categoryStdDevs[key] = stdDev;
  });
  
  // Check each month for anomalies
  months.forEach(month => {
    categoryKeys.forEach(key => {
      const expected = categoryAverages[key];
      const actual = (month.buckets as any)[key] || 0;
      const stdDev = categoryStdDevs[key];
      
      if (expected > 0 && stdDev > 0) {
        const deviation = actual - expected;
        const deviationPct = (deviation / expected) * 100;
        const zScore = Math.abs(deviation / stdDev);
        
        if (zScore > 2) { // More than 2 standard deviations
          let severity: 'low' | 'medium' | 'high' = 'low';
          if (zScore > 3) severity = 'high';
          else if (zScore > 2.5) severity = 'medium';
          
          anomalies.push({
            month: month.month,
            category: key,
            expectedAmount: expected,
            actualAmount: actual,
            deviation,
            deviationPct,
            severity,
            explanation: `Spending ${deviationPct >= 0 ? 'exceeded' : 'fell below'} expected by ${Math.abs(deviationPct).toFixed(1)}%`,
          });
        }
      }
    });
  });
  
  return anomalies;
}

/**
 * Generate common scenarios for analysis
 */
export function generateCommonScenarios(
  result: HouseholdEngineResult,
  goals: Array<{ name: string; remaining: number }>
): ScenarioAnalysis[] {
  const avgMonthlySalary = result.months.reduce((sum, m) => sum + m.incomePlanned, 0) / result.months.length;
  
  const scenarios: ScenarioAnalysis[] = [
    analyzeScenario(result, 0, 0, goals), // Baseline
    analyzeScenario(result, avgMonthlySalary * 0.1, 0, goals), // 10% salary increase
    analyzeScenario(result, -avgMonthlySalary * 0.1, 0, goals), // 10% salary decrease
    analyzeScenario(result, 0, avgMonthlySalary * 0.1, goals), // 10% expense increase
    analyzeScenario(result, 0, -avgMonthlySalary * 0.1, goals), // 10% expense decrease
    analyzeScenario(result, avgMonthlySalary * 0.1, avgMonthlySalary * 0.05, goals), // Salary up, expense up
  ];
  
  return scenarios;
}
