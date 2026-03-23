/**
 * Household Budget Engine Analytics & Predictive Service
 * Provides predictive analytics, scenario planning, and trend analysis
 */

import type { HouseholdMonthPlan, HouseholdEngineResult } from './householdBudgetEngine';

/** Bucket keys that are savings / investments — not consumption outflows. */
const SAVINGS_BUCKET_KEYS = new Set([
  'emergencySavings',
  'reserveSavings',
  'goalSavings',
  'retirementSavings',
  'investing',
  'kidsFutureSavings',
]);

/** Sum modeled monthly spending from engine buckets (excludes savings allocations). */
export function sumNonSavingsBucketOutflow(buckets: Record<string, unknown> | undefined | null): number {
  if (!buckets || typeof buckets !== 'object') return 0;
  let s = 0;
  for (const [k, v] of Object.entries(buckets)) {
    if (SAVINGS_BUCKET_KEYS.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) s += n;
  }
  return Math.max(0, s);
}

/**
 * Expense for analytics: prefer transaction-based actuals; otherwise planned; otherwise sum of non-savings buckets
 * (household engine always fills buckets even when `expenseActual` is 0).
 */
export function effectiveMonthExpense(month: HouseholdMonthPlan): number {
  const expAct = Number(month.expenseActual);
  if (Number.isFinite(expAct) && expAct > 0) return expAct;
  const totAct = Number(month.totalActualOutflow);
  if (Number.isFinite(totAct) && totAct > 0) return totAct;
  const planned = Number(month.expensePlanned);
  if (Number.isFinite(planned) && planned > 0) return planned;
  return sumNonSavingsBucketOutflow(month.buckets as Record<string, unknown>);
}

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
    const prevAmount = (prev.buckets && categoryKey in prev.buckets ? prev.buckets[categoryKey] : 0) || 0;
    const currAmount = (curr.buckets && categoryKey in curr.buckets ? curr.buckets[categoryKey] : 0) || 0;
    
    if (prevAmount > 0) {
      const changePct = ((currAmount - prevAmount) / prevAmount) * 100;
      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (changePct > 5) trend = 'increasing';
      else if (changePct < -5) trend = 'decreasing';
      
      trends.push({
        month: curr.month ?? curr.monthIndex + 1,
        category,
        amount: currAmount,
        trend,
        changePct: Number.isFinite(changePct) ? changePct : 0,
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
  
  if (!months || months.length < 3) return forecasts;
  
  try {
    // Calculate averages and trends from last 3 months (use actual if available, otherwise planned)
    const recentMonths = months.slice(-3);
    const avgIncome = recentMonths.reduce((sum, m) => {
      const income = m.incomeActual > 0 ? m.incomeActual : m.incomePlanned;
      return sum + Math.max(0, income);
    }, 0) / recentMonths.length;

    const avgExpense =
      recentMonths.reduce((sum, m) => sum + effectiveMonthExpense(m), 0) / recentMonths.length;

    // Calculate trend (use actual if available)
    const incomeValues = recentMonths.map((m) => (m.incomeActual > 0 ? m.incomeActual : m.incomePlanned));
    const expenseValues = recentMonths.map((m) => effectiveMonthExpense(m));
    
    const incomeTrend = incomeValues.length >= 2
      ? (incomeValues[incomeValues.length - 1] - incomeValues[0]) / incomeValues.length
      : 0;
    const expenseTrend = expenseValues.length >= 2
      ? (expenseValues[expenseValues.length - 1] - expenseValues[0]) / expenseValues.length
      : 0;
    
    // Calculate variance for confidence
    const incomeVariance = incomeValues.reduce((sum, val) => {
      const diff = val - avgIncome;
      return sum + (diff * diff);
    }, 0) / incomeValues.length;
    const incomeStdDev = Math.sqrt(Math.max(0, incomeVariance));
    const incomeCv = avgIncome > 0 ? incomeStdDev / avgIncome : 0;
    
    const confidence: 'high' | 'medium' | 'low' = incomeCv < 0.1 ? 'high' : incomeCv < 0.25 ? 'medium' : 'low';
    
    for (let i = 1; i <= forecastMonths; i++) {
      const predictedIncome = Math.max(0, avgIncome + (incomeTrend * i));
      const predictedExpense = Math.max(0, avgExpense + (expenseTrend * i));
      const predictedNet = predictedIncome - predictedExpense;
      
      const factors: string[] = [];
      if (avgIncome > 0 && Math.abs(incomeTrend) > avgIncome * 0.05) {
        factors.push(incomeTrend > 0 ? 'Increasing income trend' : 'Decreasing income trend');
      }
      if (avgExpense > 0 && Math.abs(expenseTrend) > avgExpense * 0.05) {
        factors.push(expenseTrend > 0 ? 'Increasing expense trend' : 'Decreasing expense trend');
      }
      if (incomeCv > 0.25) {
        factors.push('High income variability');
      }
      
      forecasts.push({
        month: months.length + i,
        predictedIncome: Number.isFinite(predictedIncome) ? predictedIncome : 0,
        predictedExpense: Number.isFinite(predictedExpense) ? predictedExpense : 0,
        predictedNet: Number.isFinite(predictedNet) ? predictedNet : 0,
        confidence,
        factors,
      });
    }
  } catch (error) {
    console.warn('Failed to predict future months:', error);
    return [];
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
  const months = result.months ?? [];
  const balanceProjection = result.balanceProjection ?? {};
  const currentYearEndBalance = Number(balanceProjection.projectedYearEndLiquid ?? 0);
  const numMonths = Math.max(1, months.length);
  const openingLiquid = Number(balanceProjection.openingLiquid ?? 0);

  const avgMonthlySalary =
    months.reduce((sum, m) => sum + (m.incomeActual > 0 ? m.incomeActual : m.incomePlanned), 0) / numMonths;
  const avgMonthlyExpense = months.reduce((sum, m) => sum + effectiveMonthExpense(m), 0) / numMonths;

  const newAvgSalary = avgMonthlySalary + monthlySalaryChange;
  const newAvgExpense = avgMonthlyExpense + monthlyExpenseChange;
  const newMonthlyNet = newAvgSalary - newAvgExpense;

  const isBaseline = monthlySalaryChange === 0 && monthlyExpenseChange === 0;

  const projectedYearEndBalance = openingLiquid + newMonthlyNet * 12;
  const projectedYearEndBalanceChange = projectedYearEndBalance - currentYearEndBalance;

  const avgGoalFunding =
    months.reduce((sum, m) => sum + Number(m.buckets?.goalSavings ?? 0), 0) / numMonths;
  const deltaNet = monthlySalaryChange - monthlyExpenseChange;
  /** Share of incremental net assumed to flow to goal savings (heuristic). */
  const goalMarginalShare = 0.35;

  const goalAchievementImpact = (goals ?? []).map((goal) => {
    if (isBaseline || !goal || (goal.remaining ?? 0) <= 0) {
      return { goalName: goal?.name ?? '', achievementDelayMonths: 0 };
    }
    const rem = Math.max(0, goal.remaining);
    const newGoalFunding = Math.max(0, avgGoalFunding + deltaNet * goalMarginalShare);
    const oldMonths = avgGoalFunding > 1e-6 ? rem / avgGoalFunding : Infinity;
    const newMonths = newGoalFunding > 1e-6 ? rem / newGoalFunding : Infinity;
    let delayMonths = 0;
    if (Number.isFinite(oldMonths) && Number.isFinite(newMonths)) {
      delayMonths = newMonths - oldMonths;
      delayMonths = Math.max(-240, Math.min(240, delayMonths));
    }
    return {
      goalName: goal.name ?? '',
      achievementDelayMonths: delayMonths,
    };
  });

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (newMonthlyNet < 0) riskLevel = 'high';
  else if (newMonthlyNet < avgMonthlySalary * 0.1) riskLevel = 'medium';

  const description =
    monthlySalaryChange !== 0 || monthlyExpenseChange !== 0
      ? `Scenario: ${monthlySalaryChange >= 0 ? '+' : ''}${monthlySalaryChange.toLocaleString()} salary change, ${monthlyExpenseChange >= 0 ? '+' : ''}${monthlyExpenseChange.toLocaleString()} expense change`
      : 'Baseline scenario';

  return {
    name: `${monthlySalaryChange >= 0 ? '+' : ''}${monthlySalaryChange.toLocaleString()} Salary / ${monthlyExpenseChange >= 0 ? '+' : ''}${monthlyExpenseChange.toLocaleString()} Expense`,
    description,
    monthlySalaryChange,
    monthlyExpenseChange,
    projectedYearEndBalance: isBaseline ? currentYearEndBalance : projectedYearEndBalance,
    projectedYearEndBalanceChange: isBaseline ? 0 : projectedYearEndBalanceChange,
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
  const categoryKeys = Object.keys(months[0].buckets ?? {});
  
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
            month: month.month ?? month.monthIndex + 1,
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
    analyzeScenario(result, 0, 0, goals ?? []), // Baseline
    analyzeScenario(result, avgMonthlySalary * 0.1, 0, goals ?? []), // 10% salary increase
    analyzeScenario(result, -avgMonthlySalary * 0.1, 0, goals), // 10% salary decrease
    analyzeScenario(result, 0, avgMonthlySalary * 0.1, goals), // 10% expense increase
    analyzeScenario(result, 0, -avgMonthlySalary * 0.1, goals), // 10% expense decrease
    analyzeScenario(result, avgMonthlySalary * 0.1, avgMonthlySalary * 0.05, goals), // Salary up, expense up
  ];
  
  return scenarios;
}

export interface SeasonalityPattern {
  category: string;
  month: number;
  monthName: string;
  averageAmount: number;
  deviationFromAverage: number;
  deviationPct: number;
  pattern: 'peak' | 'trough' | 'normal';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect seasonal spending patterns in budget data
 */
export function detectSeasonality(
  months: HouseholdMonthPlan[]
): SeasonalityPattern[] {
  const patterns: SeasonalityPattern[] = [];
  
  if (months.length < 12) return patterns; // Need at least a year of data
  
  // Group by month (1-12)
  const byMonth: Record<number, number[]> = {};
  const categoryTotals: Record<string, Record<number, number[]>> = {};
  
  months.forEach(month => {
    const monthNum = month.month ?? month.monthIndex + 1;
    if (!byMonth[monthNum]) {
      byMonth[monthNum] = [];
    }

    const expense = effectiveMonthExpense(month);
    byMonth[monthNum].push(expense);
    
    // Track by category
    Object.keys(month.buckets || {}).forEach(category => {
      if (!categoryTotals[category]) {
        categoryTotals[category] = {};
      }
      if (!categoryTotals[category][monthNum]) {
        categoryTotals[category][monthNum] = [];
      }
      const amount = (month.buckets as any)[category] || 0;
      categoryTotals[category][monthNum].push(amount);
    });
  });
  
  // Calculate overall monthly averages
  const monthlyAverages: Record<number, number> = {};
  const overallAverage =
    months.reduce((sum, m) => sum + effectiveMonthExpense(m), 0) / months.length;
  
  Object.keys(byMonth).forEach(monthStr => {
    const monthNum = Number(monthStr);
    const monthValues = byMonth[monthNum];
    monthlyAverages[monthNum] = monthValues.reduce((a, b) => a + b, 0) / monthValues.length;
  });
  
  // Detect patterns for each month
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  Object.keys(monthlyAverages).forEach(monthStr => {
    const monthNum = Number(monthStr);
    const avg = monthlyAverages[monthNum];
    const deviation = avg - overallAverage;
    const deviationPct = overallAverage > 0 ? (deviation / overallAverage) * 100 : 0;
    
    let pattern: 'peak' | 'trough' | 'normal' = 'normal';
    let confidence: 'high' | 'medium' | 'low' = 'low';
    
    if (Math.abs(deviationPct) > 15) {
      pattern = deviationPct > 0 ? 'peak' : 'trough';
      confidence = Math.abs(deviationPct) > 25 ? 'high' : 'medium';
    }
    
    patterns.push({
      category: 'Total Expenses',
      month: monthNum,
      monthName: monthNames[monthNum - 1],
      averageAmount: avg,
      deviationFromAverage: deviation,
      deviationPct,
      pattern,
      confidence,
    });
  });
  
  // Detect patterns by category
  Object.keys(categoryTotals).forEach(category => {
    const categoryData = categoryTotals[category];
    const flat = Object.values(categoryData).flat();
    const categoryOverallAvg = flat.length > 0 ? flat.reduce((a, b) => a + b, 0) / flat.length : 0;
    
    Object.keys(categoryData).forEach(monthStr => {
      const monthNum = Number(monthStr);
      const monthValues = categoryData[monthNum];
      const avg = monthValues.reduce((a, b) => a + b, 0) / monthValues.length;
      const deviation = avg - categoryOverallAvg;
      const deviationPct = categoryOverallAvg > 0 ? (deviation / categoryOverallAvg) * 100 : 0;
      
      if (Math.abs(deviationPct) > 20) {
        let pattern: 'peak' | 'trough' | 'normal' = deviationPct > 0 ? 'peak' : 'trough';
        let confidence: 'high' | 'medium' | 'low' = Math.abs(deviationPct) > 30 ? 'high' : 'medium';
        
        patterns.push({
          category,
          month: monthNum,
          monthName: monthNames[monthNum - 1],
          averageAmount: avg,
          deviationFromAverage: deviation,
          deviationPct,
          pattern,
          confidence,
        });
      }
    });
  });
  
  return patterns.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
}
