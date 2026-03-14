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
  plannedNet?: number;
  totalPlannedOutflow?: number;
  totalActualOutflow?: number;
  routedGoalAmount?: number;
  buckets?: Record<string, number>;
}

export interface HouseholdBudgetPlanResult {
  months: HouseholdMonthResult[];
  plannedVsActual: { plannedNet: number; actualNet: number };
  balanceProjection: { projectedYearEndLiquid: number; openingLiquid?: number };
  recommendations: string[];
  stressSignals?: unknown;
  dynamicBaseline?: unknown;
  emergencyGap?: number;
  reserveGap?: number;
}

/** Alias for consumers that expect HouseholdMonthPlan (e.g. analytics). */
export type HouseholdMonthPlan = HouseholdMonthResult;

/** Alias for consumers that expect HouseholdEngineResult (e.g. stress, shock drill). */
export type HouseholdEngineResult = HouseholdBudgetPlanResult;

export type HouseholdEngineProfile = 'Moderate' | 'Conservative' | 'Aggressive' | string;

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

export function buildHouseholdEngineInputFromData(
  _transactions: Array<{ date: string; type?: string; amount?: number }>,
  accounts: Array<{ type?: string; balance?: number }>,
  goals: Array<{ id?: string; name?: string; targetAmount?: number; currentAmount?: number; deadline?: string }>,
  options: {
    year?: number;
    expectedMonthlySalary?: number;
    adults?: number;
    kids?: number;
    profile?: HouseholdEngineProfile;
    monthlyOverrides?: HouseholdMonthlyOverride[];
  }
): HouseholdBudgetPlanInput {
  const salary = options?.expectedMonthlySalary ?? 0;
  const monthlySalaryPlan = Array(12).fill(salary);
  const monthlyActualIncome = monthlySalaryPlan.slice();
  const monthlyActualExpense = Array(12).fill(0);
  const liquidBalance = sumLiquidCash(accounts);
  const goalsMapped = mapGoalsForRouting(goals);
  return {
    monthlySalaryPlan,
    monthlyActualIncome,
    monthlyActualExpense,
    householdDefaults: { adults: options?.adults ?? 2, kids: options?.kids ?? 0 },
    monthlyOverrides: options?.monthlyOverrides ?? [],
    liquidBalance,
    emergencyBalance: 0,
    reserveBalance: 0,
    goals: goalsMapped,
    config: DEFAULT_HOUSEHOLD_ENGINE_CONFIG,
  };
}

export function buildHouseholdBudgetPlan(input: HouseholdBudgetPlanInput): HouseholdBudgetPlanResult {
  const { monthlySalaryPlan, monthlyActualIncome, monthlyActualExpense, liquidBalance } = input;
  const plannedNet = monthlySalaryPlan.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);
  const actualNet = monthlyActualIncome.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);
  const months: HouseholdMonthResult[] = (monthlySalaryPlan.length ? monthlySalaryPlan : Array(12).fill(0)).map((_, i) => {
    const inc = Number(monthlySalaryPlan[i] ?? 0);
    const exp = Number(monthlyActualExpense[i] ?? 0);
    const plannedNetMonth = inc - exp;
    return {
      monthIndex: i,
      month: i + 1,
      incomePlanned: inc,
      incomeActual: Number(monthlyActualIncome[i] ?? 0),
      expensePlanned: exp,
      expenseActual: exp,
      surplus: Number(monthlyActualIncome[i] ?? 0) - exp,
      reservePoolAfterDeductions: Math.max(0, liquidBalance),
      validationErrors: [],
      warnings: [],
      baselineExpense: exp,
      cashflowStress: 'healthy' as const,
      plannedNet: plannedNetMonth,
      totalPlannedOutflow: exp,
      totalActualOutflow: exp,
    };
  });
  return {
    months,
    plannedVsActual: { plannedNet, actualNet },
    balanceProjection: { projectedYearEndLiquid: liquidBalance, openingLiquid: liquidBalance },
    recommendations: [],
  };
}
