/**
 * Household Budget Engine Analytics & Predictive Service
 * Provides predictive analytics, scenario planning, and trend analysis
 */

import type { HouseholdMonthPlan, HouseholdEngineResult } from './householdBudgetEngine';
import { countsAsExpenseForCashflowKpi } from './transactionFilters';
import { toSAR } from '../utils/currencyMath';

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
  /** Month-of-year (1–12) for display. */
  month: number;
  /** Relative offset from the latest observed month (1 = next month). */
  offset: number;
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
    // Use a wider sample for stability: last 6 months (or fewer if not available).
    const recentMonths = months.slice(-Math.min(6, months.length));
    const incomeValues = recentMonths.map((m) => Math.max(0, Number(m.incomeActual) > 0 ? Number(m.incomeActual) : Number(m.incomePlanned) || 0));
    const expenseValues = recentMonths.map((m) => Math.max(0, effectiveMonthExpense(m)));

    const avgIncome = incomeValues.reduce((s, v) => s + v, 0) / Math.max(1, incomeValues.length);
    const avgExpense = expenseValues.reduce((s, v) => s + v, 0) / Math.max(1, expenseValues.length);

    // Trend based on endpoints (simple + robust): (last - first) / (n - 1)
    const denom = Math.max(1, incomeValues.length - 1);
    const incomeTrend = (incomeValues[incomeValues.length - 1] - incomeValues[0]) / denom;
    const expenseTrend = (expenseValues[expenseValues.length - 1] - expenseValues[0]) / denom;

    // Confidence: combine income + expense variability (coefficient of variation).
    const variance = (xs: number[], mean: number) =>
      xs.reduce((sum, val) => {
        const diff = val - mean;
        return sum + diff * diff;
      }, 0) / Math.max(1, xs.length);
    const incomeCv = avgIncome > 0 ? Math.sqrt(Math.max(0, variance(incomeValues, avgIncome))) / avgIncome : 0;
    const expenseCv = avgExpense > 0 ? Math.sqrt(Math.max(0, variance(expenseValues, avgExpense))) / avgExpense : 0;
    const combinedCv = Math.max(incomeCv, expenseCv);

    const confidence: 'high' | 'medium' | 'low' = combinedCv < 0.12 ? 'high' : combinedCv < 0.28 ? 'medium' : 'low';
    
    const lastObservedMonth = recentMonths[recentMonths.length - 1];
    const lastMonthNum = lastObservedMonth?.month ?? (lastObservedMonth?.monthIndex ?? (months.length - 1)) + 1;

    for (let i = 1; i <= forecastMonths; i++) {
      // Clamp trends so a single outlier month doesn't explode projections.
      const maxIncomeStep = avgIncome * 0.12;
      const maxExpenseStep = avgExpense * 0.12;
      const incomeStep = Math.max(-maxIncomeStep, Math.min(maxIncomeStep, incomeTrend)) * i;
      const expenseStep = Math.max(-maxExpenseStep, Math.min(maxExpenseStep, expenseTrend)) * i;

      const predictedIncome = Math.max(0, avgIncome + incomeStep);
      const predictedExpense = Math.max(0, avgExpense + expenseStep);
      const predictedNet = predictedIncome - predictedExpense;
      
      const factors: string[] = [];
      if (avgIncome > 0 && Math.abs(incomeTrend) > avgIncome * 0.04) {
        factors.push(incomeTrend > 0 ? 'Income trend up (recent months)' : 'Income trend down (recent months)');
      }
      if (avgExpense > 0 && Math.abs(expenseTrend) > avgExpense * 0.04) {
        factors.push(expenseTrend > 0 ? 'Expense trend up (recent months)' : 'Expense trend down (recent months)');
      }
      if (combinedCv > 0.28) {
        factors.push('High variability (forecast less certain)');
      } else if (combinedCv < 0.12) {
        factors.push('Stable recent pattern (forecast more reliable)');
      }
      
      forecasts.push({
        month: (((lastMonthNum - 1 + i) % 12) + 1),
        offset: i,
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
 * Legacy: detects “anomalies” from **household engine model buckets** (synthetic split of
 * monthly total expense). That split is a fixed template of the same `baseExpense`, so
 * every category can move in lockstep — do **not** use for per-category real alerts.
 * @deprecated Use {@link detectSpendingAnomaliesFromTransactions} for Budgets-style alerts.
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

type TxForAnomaly = {
  date: string;
  amount?: number;
  accountId?: string;
  status?: string;
  budgetCategory?: string;
  category?: string;
};

type AccountForFx = { id?: string; currency?: string };

function stdevPop(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

/**
 * Anomaly detection from **real cash transactions** (approved expenses), grouped by
 * `budgetCategory` (fallback: `category`, then `Uncategorized`), converted to SAR using
 * each account’s book currency. Compares each month to leave-one-out mean / stdev of the
 * other months in the same calendar year for that category.
 */
export function detectSpendingAnomaliesFromTransactions(args: {
  year: number;
  transactions: TxForAnomaly[];
  accounts: AccountForFx[] | null | undefined;
  sarPerUsd: number;
}): BudgetAnomaly[] {
  const { year, transactions, accounts, sarPerUsd } = args;
  const rate = Number(sarPerUsd);
  const fx = Number.isFinite(rate) && rate > 0 ? rate : 3.75;
  const accById = new Map<string, AccountForFx>(((accounts ?? []) as AccountForFx[]).map((a) => [String(a.id ?? ''), a]));

  const monthSpendByCategory: Record<string, number[]> = {};

  for (const t of transactions ?? []) {
    if ((t.status ?? 'Approved') !== 'Approved') continue;
    if (!countsAsExpenseForCashflowKpi(t as any)) continue;
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;

    const acc = accById.get(String(t.accountId ?? ''));
    const cur = acc?.currency === 'USD' ? 'USD' : 'SAR';
    const sar = Math.abs(toSAR(Number(t.amount) || 0, cur, fx));
    if (sar <= 0) continue;

    const cat = String(t.budgetCategory ?? t.category ?? '').trim() || 'Uncategorized';
    const mIdx = d.getMonth();
    if (!monthSpendByCategory[cat]) {
      monthSpendByCategory[cat] = Array(12).fill(0);
    }
    monthSpendByCategory[cat][mIdx] += sar;
  }

  const out: BudgetAnomaly[] = [];

  for (const [category, series] of Object.entries(monthSpendByCategory)) {
    const monthsWithSpend = series.map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);
    if (monthsWithSpend.length < 3) continue;

    for (let m = 0; m < 12; m++) {
      const actual = series[m] ?? 0;
      if (actual < 1) continue;

      // Baseline: other months *where this category had spend* (ignore empty months; zeros are not
      // a real "baseline" for an inactive category in that month).
      const peerAmounts = series
        .map((v, idx) => (idx === m || v < 0.5 ? null : v))
        .filter((v): v is number => v != null);
      if (peerAmounts.length < 2) continue;

      const expected = peerAmounts.reduce((a, b) => a + b, 0) / peerAmounts.length;
      const std = stdevPop(peerAmounts);
      const stdUsed = std > 1e-6 ? std : Math.max(25, Math.abs(expected) * 0.12, actual * 0.08);
      const z = (actual - expected) / stdUsed;
      if (!(actual > expected && z > 2)) continue;

      const deviation = actual - expected;
      const deviationPct = expected > 0 ? (deviation / expected) * 100 : 100;
      let severity: 'low' | 'medium' | 'high' = 'low';
      if (z > 3) severity = 'high';
      else if (z > 2.5) severity = 'medium';

      out.push({
        month: m + 1,
        category,
        expectedAmount: expected,
        actualAmount: actual,
        deviation,
        deviationPct,
        severity,
        explanation: `Spending was higher than your usual months in this category (about ${z.toFixed(1)}× typical variation vs other months with spend). ${
          expected > 0 ? `~${deviationPct.toFixed(1)}% above that baseline.` : 'Above a nearly blank baseline in other active months.'
        }`,
      });
    }
  }

  out.sort((a, b) => {
    const z = (x: BudgetAnomaly) => x.actualAmount - x.expectedAmount;
    return z(b) - z(a);
  });
  return out;
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
    
    // Track by category (exclude savings/investing buckets so output reflects real spending).
    Object.keys(month.buckets || {}).forEach(category => {
      if (SAVINGS_BUCKET_KEYS.has(category)) return;
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

    // Drop tiny/noise categories to avoid useless cards (e.g. a few SAR).
    if (!(categoryOverallAvg > 50)) return;
    
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
