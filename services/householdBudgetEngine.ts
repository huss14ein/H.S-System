/**
 * Household Budget Engine: baseline budgets and cashflow signals.
 * Minimal implementation for build compatibility.
 */

export interface HouseholdMonthlyOverride {
  monthIndex?: number;
  month?: number;
  incomeAdjustment?: number;
  expenseAdjustment?: number;
  note?: string;
  salary?: number;
  adults?: number;
  kids?: number;
  rideSupportOverride?: number;
  unusualMonthExtra?: number;
}

export interface GoalForRouting {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  savingsAllocationPercent?: number;
}

export interface HouseholdEngineConfig {
  operatingMode?: string;
  transport?: Record<string, unknown>;
  allowances?: Record<string, unknown>;
  obligations?: Record<string, unknown>;
  requiredExpenses?: Record<string, unknown>;
  bucketRules?: Record<string, unknown>;
  [key: string]: unknown;
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
  month?: number;
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
  baselineExpense: number;
  cashflowStress: 'healthy' | 'caution' | 'stress' | 'critical';
}

export interface HouseholdBudgetPlanResult {
  months: HouseholdMonthResult[];
  plannedVsActual: { plannedNet: number; actualNet: number };
  balanceProjection: { projectedYearEndLiquid: number };
  recommendations: string[];
  stressSignals?: unknown;
  dynamicBaseline?: unknown;
}

export const DEFAULT_HOUSEHOLD_ENGINE_CONFIG: HouseholdEngineConfig = {
  operatingMode: 'Balanced',
};

export const HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS: Array<{
  id: string;
  name: string;
  label: string;
  incomePct?: number;
  expensePct?: number;
  durationMonths?: number;
  defaults: { adults: number; kids: number };
  overrides: HouseholdMonthlyOverride[];
  config?: HouseholdEngineConfig;
}> = [
  {
    id: 'default',
    name: 'Default',
    label: 'Default',
    defaults: { adults: 2, kids: 0 },
    overrides: [],
  },
];

export function mapGoalsForRouting(goals: Array<{ id?: string; name?: string; targetAmount?: number; currentAmount?: number; deadline?: string }>): GoalForRouting[] {
  return (goals || []).map((g) => ({
    id: String(g.id ?? ''),
    name: String(g.name ?? ''),
    targetAmount: Number(g.targetAmount ?? 0),
    currentAmount: Number(g.currentAmount ?? 0),
    deadline: String(g.deadline ?? ''),
  }));
}

export function sumLiquidCash(accounts: Array<{ type?: string; balance?: number }>): number {
  if (!Array.isArray(accounts)) return 0;
  return accounts
    .filter((a) => ['Checking', 'Savings', 'Investment'].includes(String(a.type ?? '')))
    .reduce((sum, a) => sum + Number(a.balance ?? 0), 0);
}

export function buildHouseholdBudgetPlan(input: HouseholdBudgetPlanInput): HouseholdBudgetPlanResult {
  const { monthlySalaryPlan, monthlyActualIncome, monthlyActualExpense, liquidBalance } = input;
  const plannedNet = monthlySalaryPlan.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);
  const actualNet = monthlyActualIncome.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);
  const months: HouseholdMonthResult[] = (monthlySalaryPlan.length ? monthlySalaryPlan : Array(12).fill(0)).map((_, i) => ({
    monthIndex: i,
    month: i + 1,
    incomePlanned: Number(monthlySalaryPlan[i] ?? 0),
    incomeActual: Number(monthlyActualIncome[i] ?? 0),
    expensePlanned: Number(monthlyActualExpense[i] ?? 0),
    expenseActual: Number(monthlyActualExpense[i] ?? 0),
    surplus: Number(monthlyActualIncome[i] ?? 0) - Number(monthlyActualExpense[i] ?? 0),
    reservePoolAfterDeductions: Math.max(0, liquidBalance),
    validationErrors: [],
    warnings: [],
    baselineExpense: Number(monthlyActualExpense[i] ?? 0),
    cashflowStress: 'healthy' as const,
  }));
  return {
    months,
    plannedVsActual: { plannedNet, actualNet },
    balanceProjection: { projectedYearEndLiquid: liquidBalance },
    recommendations: [],
  };
}
