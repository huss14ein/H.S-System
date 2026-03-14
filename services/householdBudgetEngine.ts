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

/** Default months of expenses to target for emergency fund (e.g. 6). */
export const DEFAULT_EMERGENCY_TARGET_MONTHS = 6;
/** Default months of expenses for reserve pool target (e.g. 2). */
export const DEFAULT_RESERVE_TARGET_MONTHS = 2;

export const DEFAULT_HOUSEHOLD_ENGINE_CONFIG: HouseholdEngineConfig = {
  operatingMode: 'Balanced',
  emergencyTargetMonths: DEFAULT_EMERGENCY_TARGET_MONTHS,
  reserveTargetMonths: DEFAULT_RESERVE_TARGET_MONTHS,
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
  transactions: Array<{ date: string; type?: string; amount?: number }>,
  accounts: Array<{ type?: string; balance?: number }>,
  goals: Array<{ id?: string; name?: string; targetAmount?: number; currentAmount?: number; deadline?: string }>,
  options: {
    year?: number;
    expectedMonthlySalary?: number;
    adults?: number;
    kids?: number;
    profile?: HouseholdEngineProfile;
    monthlyOverrides?: HouseholdMonthlyOverride[];
    config?: HouseholdEngineConfig;
  }
): HouseholdBudgetPlanInput {
  const year = options?.year ?? new Date().getFullYear();
  const salary = options?.expectedMonthlySalary ?? 0;
  const monthlySalaryPlan = Array(12).fill(salary);
  const monthlyActualIncome = Array(12).fill(0);
  const monthlyActualExpense = Array(12).fill(0);
  if (Array.isArray(transactions)) {
    transactions.forEach((t) => {
      const d = new Date(t.date);
      if (d.getFullYear() !== year) return;
      const m = d.getMonth();
      const amount = Math.max(0, Number(t.amount) ?? 0);
      if (t.type === 'income') monthlyActualIncome[m] += amount;
      else if (t.type === 'expense') monthlyActualExpense[m] += amount;
    });
  }
  for (let i = 0; i < 12; i++) {
    if (monthlyActualIncome[i] === 0) monthlyActualIncome[i] = salary;
  }
  const liquidBalance = sumLiquidCash(accounts);
  const goalsMapped = mapGoalsForRouting(goals);
  return {
    monthlySalaryPlan,
    monthlyActualIncome,
    monthlyActualExpense,
    householdDefaults: { adults: options?.adults ?? 2, kids: options?.kids ?? 0 },
    monthlyOverrides: options?.monthlyOverrides ?? [],
    liquidBalance,
    emergencyBalance: liquidBalance,
    reserveBalance: 0,
    goals: goalsMapped,
    config: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG, ...options?.config },
  };
}

export function buildHouseholdBudgetPlan(input: HouseholdBudgetPlanInput): HouseholdBudgetPlanResult {
  const { monthlySalaryPlan, monthlyActualIncome, monthlyActualExpense, liquidBalance, emergencyBalance, reserveBalance, goals, householdDefaults, monthlyOverrides, config } = input;
  const plannedNet = monthlySalaryPlan.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);
  const actualNet = monthlyActualIncome.reduce((a, b) => a + b, 0) - monthlyActualExpense.reduce((a, b) => a + b, 0);

  const emergencyTargetMonths = Number((config as { emergencyTargetMonths?: number })?.emergencyTargetMonths) || DEFAULT_EMERGENCY_TARGET_MONTHS;
  const reserveTargetMonths = Number((config as { reserveTargetMonths?: number })?.reserveTargetMonths) || DEFAULT_RESERVE_TARGET_MONTHS;
  const operatingMode = String((config as { operatingMode?: string })?.operatingMode || 'Balanced');
  
  // Use average monthly expense across the year so emergency/reserve targets aren't skewed by a single outlier month
  const expenseValues = (monthlyActualExpense ?? []).map((e) => Number(e) ?? 0);
  const avgMonthlyExpense = expenseValues.length > 0
    ? expenseValues.reduce((a, b) => a + b, 0) / expenseValues.length
    : 0;
  const avgMonthlySalary = (monthlySalaryPlan ?? []).length > 0
    ? (monthlySalaryPlan ?? []).reduce((a, b) => a + (Number(b) ?? 0), 0) / (monthlySalaryPlan ?? []).length
    : 0;
  const monthlyExpenseForTargets = avgMonthlyExpense > 0 ? avgMonthlyExpense : (Number(avgMonthlySalary) || 0);
  const initialEmergencyGap = Math.max(0, monthlyExpenseForTargets * emergencyTargetMonths - Number(emergencyBalance ?? 0));
  const initialReserveGap = Math.max(0, monthlyExpenseForTargets * reserveTargetMonths - Number(reserveBalance ?? 0));

  // Calculate profile-based percentages
  const profile = String((config as { profile?: string })?.profile || 'Moderate');
  const getProfilePercentages = () => {
    if (profile === 'Conservative') {
      return {
        emergencySavings: 0.10, // 10% of income
        reserveSavings: 0.08,   // 8% of income
        goalSavings: 0.05,      // 5% of income
        retirementSavings: 0.15, // 15% of income
        investing: 0.05,         // 5% of income
        kidsFutureSavings: 0.03, // 3% of income
      };
    } else if (profile === 'Aggressive' || profile === 'Growth') {
      return {
        emergencySavings: 0.05, // 5% of income
        reserveSavings: 0.03,   // 3% of income
        goalSavings: 0.10,      // 10% of income
        retirementSavings: 0.20, // 20% of income
        investing: 0.15,         // 15% of income
        kidsFutureSavings: 0.05, // 5% of income
      };
    } else { // Moderate
      return {
        emergencySavings: 0.07, // 7% of income
        reserveSavings: 0.05,   // 5% of income
        goalSavings: 0.08,      // 8% of income
        retirementSavings: 0.12, // 12% of income
        investing: 0.10,         // 10% of income
        kidsFutureSavings: 0.04, // 4% of income
      };
    }
  };

  const profilePcts = getProfilePercentages();
  const adults = householdDefaults?.adults ?? 2;
  const kids = householdDefaults?.kids ?? 0;

  // Calculate expense category allocations based on household size and income
  const getExpenseAllocations = (income: number, expense: number, monthIndex: number) => {
    const override = monthlyOverrides.find(o => (o.monthIndex === monthIndex || o.month === monthIndex + 1));
    const baseExpense = expense || (income * 0.6); // Default 60% of income for expenses if no expense data
    
    // Base allocations as percentages of total expenses
    const allocations: Record<string, number> = {
      housing: baseExpense * 0.30,      // 30% - rent/mortgage
      utilities: baseExpense * 0.08,     // 8% - electricity, water, internet
      food: baseExpense * (0.15 + (adults * 0.05) + (kids * 0.03)), // 15% base + per person
      transportation: baseExpense * 0.12, // 12% - car, fuel, public transport
      health: baseExpense * 0.08,        // 8% - insurance, medical
      personalCare: baseExpense * 0.05,  // 5% - grooming, hygiene
      entertainment: baseExpense * 0.06, // 6% - leisure, dining out
      shopping: baseExpense * 0.08,      // 8% - clothing, household items
      miscellaneous: baseExpense * 0.08, // 8% - other expenses
    };

    // Apply overrides if present
    if (override?.expenseAdjustment) {
      const adjustment = override.expenseAdjustment;
      Object.keys(allocations).forEach(key => {
        allocations[key] = allocations[key] * (1 + adjustment / 100);
      });
    }

    return allocations;
  };

  let remainingEmergencyGap = initialEmergencyGap;
  let remainingReserveGap = initialReserveGap;
  let cumulativeLiquid = liquidBalance;
  let activeGoal: GoalForRouting | null = null;
  const goalsWithRemaining = goals.filter(g => (g.targetAmount - g.currentAmount) > 0);
  if (goalsWithRemaining.length > 0) {
    // Prioritize goal with closest deadline
    activeGoal = goalsWithRemaining.reduce((closest, g) => {
      if (!closest) return g;
      const closestDeadline = new Date(closest.deadline);
      const gDeadline = new Date(g.deadline);
      return gDeadline < closestDeadline ? g : closest;
    });
  }

  const months: HouseholdMonthResult[] = (monthlySalaryPlan.length ? monthlySalaryPlan : Array(12).fill(0)).map((_, i) => {
    const override = monthlyOverrides.find(o => (o.monthIndex === i || o.month === i + 1));
    const inc = override?.salary ?? Number(monthlySalaryPlan[i] ?? 0);
    const exp = Number(monthlyActualExpense[i] ?? 0);
    const actualInc = Number(monthlyActualIncome[i] ?? 0);
    const plannedNetMonth = inc - exp;
    const surplus = actualInc - exp;
    
    // Calculate buckets
    const buckets: Record<string, number> = {};
    
    // 1. Expense buckets (from actual/planned expenses)
    const expenseAllocations = getExpenseAllocations(inc, exp, i);
    Object.assign(buckets, expenseAllocations);
    
    // 2. Calculate available for savings (income - expenses)
    const availableForSavings = Math.max(0, inc - exp);
    
    // 3. Emergency savings (priority 1)
    const emergencyTarget = remainingEmergencyGap > 0 
      ? Math.min(availableForSavings * profilePcts.emergencySavings, remainingEmergencyGap / (12 - i))
      : availableForSavings * profilePcts.emergencySavings * 0.5; // Maintain 50% of allocation even when funded
    buckets.emergencySavings = Math.max(0, Math.round(emergencyTarget));
    remainingEmergencyGap = Math.max(0, remainingEmergencyGap - buckets.emergencySavings);
    
    // 4. Reserve savings (priority 2)
    const remainingAfterEmergency = availableForSavings - buckets.emergencySavings;
    const reserveTarget = remainingReserveGap > 0
      ? Math.min(remainingAfterEmergency * profilePcts.reserveSavings, remainingReserveGap / (12 - i))
      : remainingAfterEmergency * profilePcts.reserveSavings;
    buckets.reserveSavings = Math.max(0, Math.round(reserveTarget));
    remainingReserveGap = Math.max(0, remainingReserveGap - buckets.reserveSavings);
    
    // 5. Goal savings (priority 3)
    const remainingAfterReserve = remainingAfterEmergency - buckets.reserveSavings;
    if (activeGoal && operatingMode !== 'Protection First') {
      const goalRemaining = activeGoal.targetAmount - activeGoal.currentAmount;
      const goalAllocation = Math.min(remainingAfterReserve * profilePcts.goalSavings, goalRemaining / Math.max(1, 12 - i));
      buckets.goalSavings = Math.max(0, Math.round(goalAllocation));
    } else {
      buckets.goalSavings = Math.max(0, Math.round(remainingAfterReserve * profilePcts.goalSavings));
    }
    
    // 6. Retirement savings
    const remainingAfterGoal = remainingAfterReserve - buckets.goalSavings;
    buckets.retirementSavings = Math.max(0, Math.round(remainingAfterGoal * profilePcts.retirementSavings));
    
    // 7. Investing
    const remainingAfterRetirement = remainingAfterGoal - buckets.retirementSavings;
    buckets.investing = Math.max(0, Math.round(remainingAfterRetirement * profilePcts.investing));
    
    // 8. Kids future savings (if applicable)
    if (kids > 0) {
      const remainingAfterInvesting = remainingAfterRetirement - buckets.investing;
      buckets.kidsFutureSavings = Math.max(0, Math.round(remainingAfterInvesting * profilePcts.kidsFutureSavings));
    } else {
      buckets.kidsFutureSavings = 0;
    }
    
    // Update cumulative liquid balance
    cumulativeLiquid += surplus;
    
    // Calculate cashflow stress
    let cashflowStress: 'healthy' | 'caution' | 'stress' | 'critical' = 'healthy';
    if (surplus < 0) {
      const deficitPct = Math.abs(surplus) / inc;
      if (deficitPct > 0.3) cashflowStress = 'critical';
      else if (deficitPct > 0.15) cashflowStress = 'stress';
      else cashflowStress = 'caution';
    } else if (surplus < inc * 0.1) {
      cashflowStress = 'caution';
    }
    
    // Validation and warnings
    const validationErrors: string[] = [];
    const warnings: string[] = [];
    
    if (surplus < 0) {
      validationErrors.push(`Negative cashflow: ${Math.round(Math.abs(surplus)).toLocaleString()}`);
    }
    if (cumulativeLiquid < 0) {
      validationErrors.push(`Liquid balance negative: ${Math.round(Math.abs(cumulativeLiquid)).toLocaleString()}`);
    }
    if (remainingEmergencyGap > 0 && i === 11) {
      warnings.push(`Emergency fund still ${Math.round(remainingEmergencyGap).toLocaleString()} short of target`);
    }
    if (remainingReserveGap > 0 && i === 11) {
      warnings.push(`Reserve pool still ${Math.round(remainingReserveGap).toLocaleString()} short of target`);
    }
    
    return {
      monthIndex: i,
      month: i + 1,
      incomePlanned: inc,
      incomeActual: actualInc,
      expensePlanned: exp,
      expenseActual: exp,
      surplus,
      reservePoolAfterDeductions: Math.max(0, cumulativeLiquid),
      routedGoalName: activeGoal?.name,
      routedAmount: buckets.goalSavings,
      routedGoalAmount: buckets.goalSavings,
      validationErrors,
      warnings,
      baselineExpense: exp,
      cashflowStress,
      plannedNet: plannedNetMonth,
      totalPlannedOutflow: exp + Object.values(buckets).reduce((a, b) => a + b, 0),
      totalActualOutflow: exp,
      buckets,
    };
  });
  
  const recommendations: string[] = [];
  if (initialEmergencyGap > 0) {
    recommendations.push(`Build emergency fund: ~${Math.round(initialEmergencyGap).toLocaleString()} short of ${emergencyTargetMonths} months of expenses.`);
  }
  if (initialReserveGap > 0) {
    recommendations.push(`Top up reserve pool: ~${Math.round(initialReserveGap).toLocaleString()} short of ${reserveTargetMonths} months target.`);
  }
  if (goalsWithRemaining.length > 0 && operatingMode !== 'Protection First') {
    recommendations.push(`Active goal: ${activeGoal?.name || 'Multiple goals'} - allocate savings toward goal achievement.`);
  }
  if (operatingMode === 'Aggressive Goal' && goalsWithRemaining.length === 0) {
    recommendations.push('No active goals. Consider setting new financial goals to maximize growth.');
  }

  return {
    months,
    plannedVsActual: { plannedNet, actualNet },
    balanceProjection: { projectedYearEndLiquid: cumulativeLiquid, openingLiquid: liquidBalance },
    recommendations,
    emergencyGap: initialEmergencyGap,
    reserveGap: initialReserveGap,
  };
}
