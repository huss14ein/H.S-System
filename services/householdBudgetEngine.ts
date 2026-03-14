/**
 * Household Budget Engine: dynamic baseline budgets, predictive spend,
 * cashflow stress signals. Output is consumable by Wealth Ultra and other engines.
 */

import type { SuggestedBudgetRow } from '../types';
import { BUDGET_CATEGORIES, CATEGORY_PRICE_BENCHMARKS } from './budgetCategorization';

export interface HouseholdEngineConfig {
  operatingMode?: 'Conservative' | 'Balanced' | 'Growth';
  transport?: Record<string, unknown>;
  allowances?: Record<string, unknown>;
  obligations?: Record<string, unknown>;
  requiredExpenses?: {
    annualReserveEnabled?: boolean;
    annualReserveAmount?: number;
    semiAnnualReserveEnabled?: boolean;
    semiAnnualReserveAmount?: number;
    monthlyRequiredEnabled?: boolean;
    monthlyRequiredAmount?: number;
  };
  bucketRules?: Record<string, unknown>;
}

export interface HouseholdMonthlyOverride {
  monthIndex: number;
  incomeAdjustment?: number;
  expenseAdjustment?: number;
  note?: string;
}

export interface GoalForRouting {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  savingsAllocationPercent?: number;
}

export interface HouseholdBudgetPlanInput {
  monthlySalaryPlan: number[];
  monthlyActualIncome: number[];
  monthlyActualExpense: number[];
  householdDefaults: { adults: number; kids: number };
  monthlyOverrides: HouseholdMonthlyOverride[];
  liquidBalance: number;
  emergencyBalance: number;
  reserveBalance: number;
  goals: GoalForRouting[];
  config: HouseholdEngineConfig;
}

export interface HouseholdMonthResult {
  monthIndex: number;
  incomePlanned: number;
  incomeActual: number;
  expensePlanned: number;
  expenseActual: number;
  surplus: number;
  reservePoolAfterDeductions: number;
  routedGoalName?: string;
  routedAmount?: number;
  validationErrors: string[];
  warnings: string[];
  /** Dynamic baseline for this month (used for predictive spend). */
  baselineExpense: number;
  /** Stress signal: 'healthy' | 'caution' | 'stress' | 'critical' */
  cashflowStress: 'healthy' | 'caution' | 'stress' | 'critical';
}

export interface HouseholdBudgetPlanResult {
  months: HouseholdMonthResult[];
  plannedVsActual: { plannedNet: number; actualNet: number };
  balanceProjection: { projectedYearEndLiquid: number };
  recommendations: string[];
  /** Consumable by other engines: household-level stress and cash constraints. */
  stressSignals: HouseholdStressSignals;
  /** Dynamic baseline (rolling avg or config-driven) for predictive spend. */
  dynamicBaseline: DynamicBaselineResult;
  /** Next-period predictive spend (for Wealth Ultra / planning). */
  predictiveSpend: PredictiveSpendResult;
}

export interface HouseholdStressSignals {
  overall: 'healthy' | 'caution' | 'stress' | 'critical';
  monthsInStress: number;
  monthsInCaution: number;
  minReservePool: number;
  runwayMonths: number;
  /** Suggested max discretionary investment from household view (can be used to cap Wealth Ultra cash). */
  suggestedMaxInvestmentFromHousehold: number;
}

export interface DynamicBaselineResult {
  /** Baseline monthly expense (e.g. rolling 3-month or last 12 avg). */
  baselineMonthlyExpense: number;
  /** Baseline monthly income. */
  baselineMonthlyIncome: number;
  /** Category-level baselines when available. */
  categoryBaselines: Record<string, number>;
}

export interface PredictiveSpendResult {
  nextMonthExpense: number;
  nextMonthIncome: number;
  nextQuarterAvgExpense: number;
  confidence: 'low' | 'medium' | 'high';
}

const MONTHS = 12;

export const DEFAULT_HOUSEHOLD_ENGINE_CONFIG: HouseholdEngineConfig = {
  operatingMode: 'Balanced',
  transport: {},
  allowances: {},
  obligations: {},
  requiredExpenses: {
    annualReserveEnabled: false,
    annualReserveAmount: 0,
    semiAnnualReserveEnabled: false,
    semiAnnualReserveAmount: 0,
    monthlyRequiredEnabled: false,
    monthlyRequiredAmount: 0,
  },
  bucketRules: {},
};

export const HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS = [
  { name: 'Recession', incomePct: -10, expensePct: 5, durationMonths: 3 },
  { name: 'Job loss', incomePct: -100, expensePct: 0, durationMonths: 6 },
  { name: 'Promotion', incomePct: 15, expensePct: 0, durationMonths: 12 },
];

/** Sum liquid cash from checking + savings accounts. */
export function sumLiquidCash(accounts: Array<{ type?: string; balance?: number }>): number {
  if (!Array.isArray(accounts)) return 0;
  return accounts
    .filter((a) => a.type === 'Checking' || a.type === 'Savings')
    .reduce((s, a) => s + (Number(a.balance) || 0), 0);
}

/** Map app goals to minimal shape for routing. */
export function mapGoalsForRouting(goals: Array<{ id: string; name: string; targetAmount: number; currentAmount: number; deadline: string; savingsAllocationPercent?: number }>): GoalForRouting[] {
  if (!Array.isArray(goals)) return [];
  return goals.map((g) => ({
    id: g.id,
    name: g.name || 'Goal',
    targetAmount: Number(g.targetAmount) || 0,
    currentAmount: Number(g.currentAmount) || 0,
    deadline: g.deadline || '',
    savingsAllocationPercent: g.savingsAllocationPercent,
  }));
}

function applyOverrides(
  baseIncome: number[],
  baseExpense: number[],
  overrides: HouseholdMonthlyOverride[]
): { income: number[]; expense: number[] } {
  const income = [...baseIncome];
  const expense = [...baseExpense];
  for (const o of overrides) {
    const i = Math.max(0, Math.min(o.monthIndex, MONTHS - 1));
    if (o.incomeAdjustment != null) income[i] = (income[i] || 0) + o.incomeAdjustment;
    if (o.expenseAdjustment != null) expense[i] = (expense[i] || 0) + o.expenseAdjustment;
  }
  return { income, expense };
}

function computeDynamicBaseline(
  monthlyActualIncome: number[],
  monthlyActualExpense: number[]
): DynamicBaselineResult {
  const hasIncome = monthlyActualIncome.filter((x) => x > 0).length;
  const hasExpense = monthlyActualExpense.filter((x) => x > 0).length;
  const sumIncome = monthlyActualIncome.reduce((a, b) => a + b, 0);
  const sumExpense = monthlyActualExpense.reduce((a, b) => a + b, 0);
  const avgIncome = hasIncome > 0 ? sumIncome / hasIncome : 0;
  const avgExpense = hasExpense > 0 ? sumExpense / Math.max(1, hasExpense) : 0;
  const baselineMonthlyIncome = hasIncome >= 3 ? sumIncome / MONTHS : avgIncome || 0;
  const baselineMonthlyExpense = hasExpense >= 3 ? sumExpense / MONTHS : avgExpense || 0;
  return {
    baselineMonthlyExpense,
    baselineMonthlyIncome,
    categoryBaselines: {},
  };
}

function computePredictiveSpend(
  monthlyActualExpense: number[],
  dynamicBaseline: DynamicBaselineResult
): PredictiveSpendResult {
  const lastThree = monthlyActualExpense.slice(-3).filter((x) => x > 0);
  const nextMonth = lastThree.length > 0
    ? lastThree.reduce((a, b) => a + b, 0) / lastThree.length
    : dynamicBaseline.baselineMonthlyExpense;
  const nextQuarter = monthlyActualExpense.filter((x) => x > 0).length >= 2
    ? monthlyActualExpense.reduce((a, b) => a + b, 0) / MONTHS
    : dynamicBaseline.baselineMonthlyExpense;
  return {
    nextMonthExpense: nextMonth,
    nextMonthIncome: dynamicBaseline.baselineMonthlyIncome,
    nextQuarterAvgExpense: nextQuarter,
    confidence: lastThree.length >= 2 ? 'medium' : 'low',
  };
}

function stressLevel(
  reservePool: number,
  baselineExpense: number,
  surplus: number
): 'healthy' | 'caution' | 'stress' | 'critical' {
  if (baselineExpense <= 0) return reservePool >= 0 ? 'healthy' : 'caution';
  const monthsCovered = reservePool / baselineExpense;
  if (monthsCovered >= 6 && surplus >= 0) return 'healthy';
  if (monthsCovered >= 3 && surplus >= -baselineExpense * 0.1) return 'caution';
  if (monthsCovered >= 1) return 'stress';
  return 'critical';
}

/** Build full household budget plan with dynamic baseline, predictive spend, and stress signals. */
export function buildHouseholdBudgetPlan(input: HouseholdBudgetPlanInput): HouseholdBudgetPlanResult {
  const {
    monthlySalaryPlan,
    monthlyActualIncome,
    monthlyActualExpense,
    householdDefaults,
    monthlyOverrides,
    liquidBalance,
    reserveBalance,
    goals,
    config,
  } = input;

  const { income: incomePlanned, expense: expensePlanned } = applyOverrides(
    monthlySalaryPlan.length >= MONTHS ? monthlySalaryPlan.slice(0, MONTHS) : [...monthlySalaryPlan, ...Array(MONTHS).fill(0)].slice(0, MONTHS),
    Array(MONTHS).fill(0),
    monthlyOverrides
  );
  const expenseActual = monthlyActualExpense.length >= MONTHS
    ? monthlyActualExpense.slice(0, MONTHS)
    : [...monthlyActualExpense, ...Array(MONTHS).fill(0)].slice(0, MONTHS);
  const incomeActual = monthlyActualIncome.length >= MONTHS
    ? monthlyActualIncome.slice(0, MONTHS)
    : [...monthlyActualIncome, ...Array(MONTHS).fill(0)].slice(0, MONTHS);

  const dynamicBaseline = computeDynamicBaseline(incomeActual, expenseActual);
  const predictiveSpend = computePredictiveSpend(expenseActual, dynamicBaseline);
  const baselineExpense = dynamicBaseline.baselineMonthlyExpense || 1;

  const months: HouseholdMonthResult[] = [];
  let runningLiquid = liquidBalance;
  let plannedNet = 0;
  let actualNet = 0;
  let monthsInStress = 0;
  let monthsInCaution = 0;
  let minReservePool = runningLiquid;

  const activeGoal = goals.length > 0 ? goals[0] : null;
  const savingsPct = (activeGoal?.savingsAllocationPercent ?? 20) / 100;

  for (let i = 0; i < MONTHS; i++) {
    const incP = incomePlanned[i] ?? 0;
    const incA = incomeActual[i] ?? 0;
    const expP = expensePlanned[i] ?? 0;
    const expA = expenseActual[i] ?? 0;
    const surplus = incA - expA;
    plannedNet += incP - expP;
    actualNet += incA - expA;

    const reserved = reserveBalance * 0.1;
    const routedAmount = activeGoal && surplus > 0 ? surplus * savingsPct : 0;
    runningLiquid += surplus - routedAmount;
    const reservePoolAfterDeductions = Math.max(0, runningLiquid - reserved);
    if (reservePoolAfterDeductions < minReservePool) minReservePool = reservePoolAfterDeductions;

    const stress = stressLevel(reservePoolAfterDeductions, baselineExpense, surplus);
    if (stress === 'stress' || stress === 'critical') monthsInStress++;
    else if (stress === 'caution') monthsInCaution++;

    const validationErrors: string[] = [];
    const warnings: string[] = [];
    if (runningLiquid < 0) validationErrors.push(`Month ${i + 1}: negative projected balance.`);
    if (reservePoolAfterDeductions < baselineExpense * 2) warnings.push('Reserve pool below 2 months baseline expense.');
    if (surplus < 0 && reservePoolAfterDeductions < baselineExpense * 3) warnings.push('Deficit month with low reserve.');

    months.push({
      monthIndex: i,
      incomePlanned: incP,
      incomeActual: incA,
      expensePlanned: expP,
      expenseActual: expA,
      surplus,
      reservePoolAfterDeductions,
      routedGoalName: activeGoal?.name,
      routedAmount,
      validationErrors,
      warnings,
      baselineExpense: dynamicBaseline.baselineMonthlyExpense,
      cashflowStress: stress,
    });
  }

  const projectedYearEndLiquid = runningLiquid;
  const overallStress: HouseholdStressSignals['overall'] =
    monthsInStress > 2 ? 'critical' : monthsInStress > 0 ? 'stress' : monthsInCaution > 3 ? 'caution' : 'healthy';
  const runwayMonths = baselineExpense > 0 ? minReservePool / baselineExpense : 12;
  const suggestedMaxInvestmentFromHousehold =
    overallStress === 'healthy'
      ? Math.max(0, liquidBalance - reserveBalance * 0.5)
      : overallStress === 'caution'
        ? Math.max(0, liquidBalance * 0.2)
        : 0;

  const recommendations: string[] = [];
  if (overallStress === 'stress' || overallStress === 'critical') {
    recommendations.push('Reduce discretionary spending or increase income to improve cash runway.');
  }
  if (monthsInCaution > 2) {
    recommendations.push('Build emergency reserve to at least 3 months of baseline expense.');
  }
  if (activeGoal && projectedYearEndLiquid > liquidBalance) {
    recommendations.push(`On track to route savings to goal "${activeGoal.name}".`);
  }

  const stressSignals: HouseholdStressSignals = {
    overall: overallStress,
    monthsInStress,
    monthsInCaution,
    minReservePool,
    runwayMonths,
    suggestedMaxInvestmentFromHousehold,
  };

  return {
    months,
    plannedVsActual: { plannedNet, actualNet },
    balanceProjection: { projectedYearEndLiquid },
    recommendations,
    stressSignals,
    dynamicBaseline,
    predictiveSpend,
  };
}

/** Saudi-focused suggested budget rows by adults, kids, and net salary. Used by "Generate from household" on Budgets page. */
export function getSuggestedBudgetsFromHousehold(input: { adults: number; kids: number; monthlySalaryNet: number }): SuggestedBudgetRow[] {
  const { adults, kids, monthlySalaryNet } = input;
  const salary = Math.max(0, monthlySalaryNet);
  const householdSize = Math.max(1, adults + kids * 0.5);
  const results: SuggestedBudgetRow[] = [];

  for (const cat of BUDGET_CATEGORIES) {
    const bench = CATEGORY_PRICE_BENCHMARKS[cat];
    if (!bench) continue;
    let limit: number;
    let period: 'monthly' | 'yearly' | 'weekly' | 'daily' = 'monthly';

    switch (cat) {
      case 'Food':
        limit = Math.round(bench.typical * (0.6 + 0.25 * adults + 0.15 * kids));
        break;
      case 'Transportation':
        limit = Math.round(bench.typical * (0.7 + 0.2 * adults));
        break;
      case 'Housing':
        limit = Math.round(Math.min(bench.high, Math.max(bench.low, salary * 0.35)));
        break;
      case 'Utilities':
        limit = Math.round(bench.typical * (0.8 + 0.1 * adults));
        break;
      case 'Shopping':
        limit = Math.round(bench.typical * householdSize);
        break;
      case 'Entertainment':
        limit = Math.round(bench.typical * householdSize);
        break;
      case 'Health':
        limit = Math.round(bench.typical * householdSize * 12);
        period = 'yearly';
        break;
      case 'Education':
        limit = Math.round(bench.typical * Math.max(0, kids) * 12);
        period = 'yearly';
        break;
      case 'Savings & Investments':
        limit = Math.round(Math.max(bench.low, Math.min(bench.high, salary * 0.2)));
        break;
      case 'Personal Care':
        limit = Math.round(bench.typical * adults);
        break;
      case 'Miscellaneous':
        limit = Math.round(bench.typical * householdSize);
        break;
      default:
        limit = bench.typical;
    }

    limit = Math.max(0, limit);
    results.push({ category: cat, limit, period, tier: 'Optional' });
  }

  return results;
}
