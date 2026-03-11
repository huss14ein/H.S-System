export type HouseholdBucketKey =
  | 'fixedObligations'
  | 'householdEssentials'
  | 'householdOperations'
  | 'transport'
  | 'personalSupport'
  | 'reserveSavings'
  | 'emergencySavings'
  | 'goalSavings'
  | 'kidsFutureSavings'
  | 'retirementSavings'
  | 'investing';

export interface HouseholdBucketRule {
  enabled: boolean;
  minPctOfSalary?: number;
  maxPctOfSalary?: number;
}

export interface HouseholdEngineConfig {
  operatingMode?: 'Balanced' | 'Aggressive Goal' | 'Protection First' | 'Growth/Investing Support';
  emergencyTargetMonths: number;
  reserveTargetMonths: number;
  utilities: {
    baseMonthly: number;
    perAdultLoad: number;
    perKidLoad: number;
  };
  transport: {
    singleDriverBaseCost: number;
    rideSupportEnabled: boolean;
    rideSupportCost: number;
  };
  allowances: {
    spouseFixedEnabled: boolean;
    spouseFixedAmount: number;
    personalAllowanceEnabled: boolean;
    personalAllowancePerAdult: number;
  };
  obligations: {
    annual: number;
    semiAnnual: number;
    monthlyFixed: number;
    annualDueMonth?: number;
    semiAnnualDueMonths?: number[];
  };
  requiredExpenses: {
    annualReserveEnabled: boolean;
    annualReserveAmount: number;
    semiAnnualReserveEnabled: boolean;
    semiAnnualReserveAmount: number;
    monthlyRequiredEnabled: boolean;
    monthlyRequiredAmount: number;
  };
  autoRouteGoalPriority: string[];
  bucketRules: Record<HouseholdBucketKey, HouseholdBucketRule>;
}

export interface HouseholdComposition {
  adults: number;
  kids: number;
}

export interface HouseholdMonthlyOverride {
  month: number;
  adults?: number;
  kids?: number;
  salary?: number;
  fixedObligations?: number;
  essentials?: number;
  rideSupportOverride?: number;
  unusualMonthExtra?: number;
}

export interface HouseholdEngineInput {
  monthlySalaryPlan: number[];
  monthlyActualIncome?: number[];
  monthlyActualExpense?: number[];
  householdDefaults: HouseholdComposition;
  monthlyOverrides?: HouseholdMonthlyOverride[];
  liquidBalance: number;
  emergencyBalance: number;
  reserveBalance: number;
  goals: Array<{ name: string; remaining: number }>;
  config?: Partial<HouseholdEngineConfig>;
}

export interface HouseholdMonthPlan {
  month: number;
  adults: number;
  kids: number;
  incomePlanned: number;
  incomeActual: number;
  totalPlannedOutflow: number;
  totalActualOutflow: number;
  plannedNet: number;
  actualNet: number;
  routedGoalName?: string;
  routedGoalAmount: number;
  reservePoolAfterDeductions: number;
  buckets: Record<HouseholdBucketKey, number>;
  validationErrors?: string[];
  warnings: string[];
}

export interface HouseholdEngineResult {
  config: HouseholdEngineConfig;
  months: HouseholdMonthPlan[];
  annualBuckets: Record<HouseholdBucketKey, number>;
  recommendations: string[];
  /** Suggested profile when income variance is high (engine recommends Conservative). */
  suggestedProfile?: HouseholdEngineProfile | null;
  plannedVsActual: {
    plannedIncome: number;
    actualIncome: number;
    plannedOutflow: number;
    actualOutflow: number;
    plannedNet: number;
    actualNet: number;
  };
  balanceProjection: {
    openingLiquid: number;
    projectedYearEndLiquid: number;
  };
}

/** Suggests Conservative profile when monthly income varies a lot (coefficient of variation > 0.25). */
export function suggestProfileFromIncomeVariance(monthlyActualIncome: number[]): HouseholdEngineProfile | null {
  const values = (monthlyActualIncome || []).filter((v) => v > 0);
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? std / mean : 0;
  return cv > 0.25 ? 'Conservative' : null;
}

/** Infers obligation estimates from transaction history (fixed-like categories). */
export function inferObligationsFromTransactions(
  transactions: Array<{ date: string; type?: string; amount?: number; category?: string; budgetCategory?: string; budget_category?: string }>,
  year: number
): Partial<HouseholdEngineConfig> {
  const fixedLike = new Set(['Housing', 'Utilities', 'Insurance', 'Loan', 'Rent', 'Mortgage', 'Transportation']);
  const byMonth = Array(12).fill(0);
  (transactions || []).forEach((t) => {
    if (t.type !== 'expense') return;
    const d = new Date(t.date);
    if (d.getFullYear() !== year) return;
    const cat = String((t as any).budgetCategory ?? (t as any).budget_category ?? t.category ?? '').trim();
    const amount = Math.abs(Number(t.amount) || 0);
    byMonth[d.getMonth()] += amount;
  });
  const totalExpense = byMonth.reduce((a, b) => a + b, 0);
  const monthsWithData = byMonth.filter((v) => v > 0).length;
  const avgMonthly = monthsWithData > 0 ? totalExpense / monthsWithData : 0;
  if (avgMonthly <= 0) return {};
  return {
    obligations: {
      annual: Math.round(avgMonthly * 12 * 100) / 100,
      semiAnnual: Math.round(avgMonthly * 6 * 100) / 100,
      monthlyFixed: 0,
      annualDueMonth: 12,
      semiAnnualDueMonths: [6, 12],
    },
    requiredExpenses: {
      annualReserveEnabled: true,
      annualReserveAmount: Math.max(6000, Math.round(avgMonthly * 3 * 100) / 100),
      semiAnnualReserveEnabled: true,
      semiAnnualReserveAmount: Math.max(3600, Math.round(avgMonthly * 2 * 100) / 100),
      monthlyRequiredEnabled: true,
      monthlyRequiredAmount: Math.max(200, Math.round(avgMonthly * 0.1 * 100) / 100),
    },
  };
}

export function mapGoalsForRouting(goals: Array<{ name?: string; targetAmount?: number; target_amount?: number; currentAmount?: number; current_amount?: number }>): Array<{ name: string; remaining: number }> {
  return (goals || [])
    .map((g) => ({
      name: String(g.name || 'Goal'),
      remaining: Math.max(0, Number(g.targetAmount ?? g.target_amount ?? 0) - Number(g.currentAmount ?? g.current_amount ?? 0)),
    }))
    .filter((g) => g.remaining > 0);
}

export function sumLiquidCash(accounts: Array<{ type?: string; balance?: number }>): number {
  return (accounts || [])
    .filter((a) => a.type === 'Checking' || a.type === 'Savings')
    .reduce((sum, a) => sum + Math.max(0, Number(a.balance) || 0), 0);
}

export const HOUSEHOLD_BUCKET_LABELS: Record<HouseholdBucketKey, string> = {
  fixedObligations: 'Fixed Obligations',
  householdEssentials: 'Household Essentials',
  householdOperations: 'Household Operations',
  transport: 'Transport (Single Driver)',
  personalSupport: 'Personal/Spouse Support',
  reserveSavings: 'Reserve Savings',
  emergencySavings: 'Emergency Savings',
  goalSavings: 'Goal Savings',
  kidsFutureSavings: 'Kids Future Savings',
  retirementSavings: 'Retirement Savings',
  investing: 'Investing',
};

export const DEFAULT_HOUSEHOLD_ENGINE_CONFIG: HouseholdEngineConfig = {
  operatingMode: 'Balanced',
  emergencyTargetMonths: 6,
  reserveTargetMonths: 2,
  utilities: {
    baseMonthly: 420,
    perAdultLoad: 110,
    perKidLoad: 65,
  },
  transport: {
    singleDriverBaseCost: 900,
    rideSupportEnabled: false,
    rideSupportCost: 0,
  },
  allowances: {
    spouseFixedEnabled: true,
    spouseFixedAmount: 1200,
    personalAllowanceEnabled: false,
    personalAllowancePerAdult: 250,
  },
  obligations: {
    annual: 12000,
    semiAnnual: 6000,
    monthlyFixed: 0,
    annualDueMonth: 12,
    semiAnnualDueMonths: [6, 12],
  },
  requiredExpenses: {
    annualReserveEnabled: true,
    annualReserveAmount: 6000,
    semiAnnualReserveEnabled: true,
    semiAnnualReserveAmount: 3600,
    monthlyRequiredEnabled: true,
    monthlyRequiredAmount: 300,
  },
  autoRouteGoalPriority: ['House', 'Car'],
  bucketRules: {
    fixedObligations: { enabled: true },
    householdEssentials: { enabled: true },
    householdOperations: { enabled: true, minPctOfSalary: 0.08 },
    transport: { enabled: true },
    personalSupport: { enabled: false },
    reserveSavings: { enabled: true, minPctOfSalary: 0.05 },
    emergencySavings: { enabled: true, minPctOfSalary: 0.07 },
    goalSavings: { enabled: true, minPctOfSalary: 0.06 },
    kidsFutureSavings: { enabled: true, minPctOfSalary: 0.03 },
    retirementSavings: { enabled: true, minPctOfSalary: 0.1 },
    investing: { enabled: true, minPctOfSalary: 0.04 },
  },
};

/** Profile presets for fully automated engine: one choice, no manual config. */
export type HouseholdEngineProfile = 'Conservative' | 'Moderate' | 'Growth';

export const HOUSEHOLD_ENGINE_PROFILES: Record<HouseholdEngineProfile, { label: string; description: string; config: Partial<HouseholdEngineConfig> }> = {
  Conservative: {
    label: 'Conservative',
    description: 'Higher emergency & reserve; lower investing. Best when income is variable.',
    config: {
      operatingMode: 'Protection First',
      emergencyTargetMonths: 9,
      reserveTargetMonths: 3,
      bucketRules: {
        ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.bucketRules,
        emergencySavings: { enabled: true, minPctOfSalary: 0.12 },
        reserveSavings: { enabled: true, minPctOfSalary: 0.08 },
        investing: { enabled: true, minPctOfSalary: 0.02 },
        goalSavings: { enabled: true, minPctOfSalary: 0.04 },
      },
    },
  },
  Moderate: {
    label: 'Moderate',
    description: 'Balanced safety and growth. Default for most households.',
    config: {
      operatingMode: 'Balanced',
      emergencyTargetMonths: 6,
      reserveTargetMonths: 2,
      bucketRules: DEFAULT_HOUSEHOLD_ENGINE_CONFIG.bucketRules,
    },
  },
  Growth: {
    label: 'Growth',
    description: 'Higher investing and goal savings; lower reserve. When income is stable.',
    config: {
      operatingMode: 'Growth/Investing Support',
      emergencyTargetMonths: 4,
      reserveTargetMonths: 1.5,
      bucketRules: {
        ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.bucketRules,
        emergencySavings: { enabled: true, minPctOfSalary: 0.05 },
        reserveSavings: { enabled: true, minPctOfSalary: 0.04 },
        investing: { enabled: true, minPctOfSalary: 0.1 },
        goalSavings: { enabled: true, minPctOfSalary: 0.08 },
      },
    },
  },
};

export interface AutoHouseholdInputOptions {
  /** Calendar year to project (1–12 months). */
  year: number;
  /** Optional: expected monthly salary for future months when no transactions exist. */
  expectedMonthlySalary?: number;
  /** Household size; defaults to 1 adult if not set. */
  adults?: number;
  kids?: number;
  /** Profile preset; defaults to Moderate. */
  profile?: HouseholdEngineProfile;
  /** Optional monthly overrides (e.g. known salary change in one month). */
  monthlyOverrides?: HouseholdMonthlyOverride[];
  /** When true, infer obligations/required expenses from transaction history. Default true. */
  inferObligationsFromHistory?: boolean;
}

export interface AutoHouseholdPlanDataOptions extends Omit<AutoHouseholdInputOptions, 'year'> {
  /** Calendar year for context (used for reserve/emergency labels). */
  year?: number;
}

/**
 * Builds engine input from your real data. Fully automated: income/expense from transactions,
 * liquid/reserve from accounts, goals from goals. Only optional overrides: one expected salary,
 * household size, and profile. No manual buckets or long tables.
 */
export function buildHouseholdEngineInputFromData(
  transactions: Array<{ date: string; type?: string; amount?: number }>,
  accounts: Array<{ type?: string; balance?: number }>,
  goals: Array<{ name?: string; targetAmount?: number; target_amount?: number; currentAmount?: number; current_amount?: number }>,
  options: AutoHouseholdInputOptions
): HouseholdEngineInput {
  const { year, expectedMonthlySalary, adults = 1, kids = 0, profile = 'Moderate', monthlyOverrides = [], inferObligationsFromHistory = true } = options;
  const incomeByMonth = Array(12).fill(0);
  const expenseByMonth = Array(12).fill(0);
  (transactions || []).forEach((t) => {
    const d = new Date(t.date);
    if (d.getFullYear() !== year) return;
    const m = d.getMonth();
    const amount = Number(t.amount) || 0;
    if (t.type === 'income') incomeByMonth[m] += Math.max(0, amount);
    if (t.type === 'expense') expenseByMonth[m] += Math.abs(amount);
  });

  const liquidCash = sumLiquidCash(accounts || []);
  const goalsForRouting = mapGoalsForRouting(goals || []);

  const pastIncome = incomeByMonth.filter((v) => v > 0);
  const avgIncome = pastIncome.length > 0 ? pastIncome.reduce((a, b) => a + b, 0) / pastIncome.length : 0;
  const salaryFallback = expectedMonthlySalary && expectedMonthlySalary > 0 ? expectedMonthlySalary : avgIncome;

  const monthlySalaryPlan = incomeByMonth.map((v, i) => {
    if (v > 0) return v;
    return salaryFallback;
  });

  const profileConfig = HOUSEHOLD_ENGINE_PROFILES[profile]?.config ?? HOUSEHOLD_ENGINE_PROFILES.Moderate.config;
  const autoGoalPriority = goalsForRouting.length > 0
    ? [...goalsForRouting].sort((a, b) => b.remaining - a.remaining).map((g) => g.name)
    : undefined;
  const inferred = inferObligationsFromHistory && (transactions?.length ?? 0) > 0
    ? inferObligationsFromTransactions(transactions as any[], year)
    : {};

  return {
    monthlySalaryPlan,
    monthlyActualIncome: incomeByMonth,
    monthlyActualExpense: expenseByMonth,
    householdDefaults: { adults, kids },
    monthlyOverrides,
    liquidBalance: liquidCash,
    emergencyBalance: liquidCash,
    reserveBalance: Math.max(0, liquidCash * 0.35),
    goals: goalsForRouting,
    config: {
      ...profileConfig,
      ...inferred,
      autoRouteGoalPriority: autoGoalPriority ?? profileConfig?.autoRouteGoalPriority ?? DEFAULT_HOUSEHOLD_ENGINE_CONFIG.autoRouteGoalPriority,
    },
  };
}

/**
 * Builds engine input from Plan page data (monthly planned/actual arrays). Same profile-based automation;
 * use when income/expense come from Plan rows instead of raw transactions.
 */
export function buildHouseholdEngineInputFromPlanData(
  monthlyIncomePlanned: number[],
  monthlyIncomeActual: number[],
  monthlyExpenseActual: number[],
  accounts: Array<{ type?: string; balance?: number }>,
  goals: Array<{ name?: string; targetAmount?: number; target_amount?: number; currentAmount?: number; current_amount?: number }>,
  options: AutoHouseholdPlanDataOptions
): HouseholdEngineInput {
  const { expectedMonthlySalary, adults = 1, kids = 0, profile = 'Moderate', monthlyOverrides = [] } = options;
  const liquidCash = sumLiquidCash(accounts || []);
  const goalsForRouting = mapGoalsForRouting(goals || []);

  const planned = monthlyIncomePlanned.length >= 12 ? monthlyIncomePlanned.slice(0, 12) : [...monthlyIncomePlanned, ...Array(12).fill(0)].slice(0, 12);
  const actualInc = monthlyIncomeActual.length >= 12 ? monthlyIncomeActual.slice(0, 12) : [...monthlyIncomeActual, ...Array(12).fill(0)].slice(0, 12);
  const actualExp = monthlyExpenseActual.length >= 12 ? monthlyExpenseActual.slice(0, 12) : [...monthlyExpenseActual, ...Array(12).fill(0)].slice(0, 12);

  const pastIncome = actualInc.filter((v) => v > 0);
  const avgIncome = pastIncome.length > 0 ? pastIncome.reduce((a, b) => a + b, 0) / pastIncome.length : 0;
  const salaryFallback = expectedMonthlySalary && expectedMonthlySalary > 0 ? expectedMonthlySalary : avgIncome;

  const monthlySalaryPlan = planned.map((v, i) => (v > 0 ? v : (actualInc[i] > 0 ? actualInc[i] : salaryFallback)));

  const profileConfig = HOUSEHOLD_ENGINE_PROFILES[profile]?.config ?? HOUSEHOLD_ENGINE_PROFILES.Moderate.config;
  const autoGoalPriority = goalsForRouting.length > 0
    ? [...goalsForRouting].sort((a, b) => b.remaining - a.remaining).map((g) => g.name)
    : undefined;

  return {
    monthlySalaryPlan,
    monthlyActualIncome: actualInc,
    monthlyActualExpense: actualExp,
    householdDefaults: { adults, kids },
    monthlyOverrides,
    liquidBalance: liquidCash,
    emergencyBalance: liquidCash,
    reserveBalance: Math.max(0, liquidCash * 0.35),
    goals: goalsForRouting,
    config: {
      ...profileConfig,
      autoRouteGoalPriority: autoGoalPriority ?? profileConfig?.autoRouteGoalPriority ?? DEFAULT_HOUSEHOLD_ENGINE_CONFIG.autoRouteGoalPriority,
    },
  };
}

export const HOUSEHOLD_ENGINE_SAMPLE_SCENARIOS: Array<{ id: string; label: string; defaults: HouseholdComposition; overrides: HouseholdMonthlyOverride[]; config?: Partial<HouseholdEngineConfig> }> = [
  {
    id: 'normal-family',
    label: 'Normal year (2 adults, 2 kids)',
    defaults: { adults: 2, kids: 2 },
    overrides: [{ month: 9, kids: 3 }],
  },
  {
    id: 'pressure-year',
    label: 'High-pressure year (income dip + cost spike)',
    defaults: { adults: 2, kids: 1 },
    overrides: [
      { month: 3, salary: 0 },
      { month: 4, salary: 0 },
      { month: 7, fixedObligations: 6000, essentials: 7000 },
      { month: 8, fixedObligations: 6000, essentials: 7000 },
    ],
    config: { transport: { singleDriverBaseCost: 1200, rideSupportEnabled: true, rideSupportCost: 550 } },
  },
  {
    id: 'goal-routing',
    label: 'Goal routing (house first then car)',
    defaults: { adults: 2, kids: 0 },
    overrides: [],
    config: { autoRouteGoalPriority: ['House', 'Car', 'Travel'] },
  },
];

const round2 = (v: number) => Math.round(v * 100) / 100;
const toCurrency = (v: number) => Math.max(0, round2(Number(v) || 0));

function mergeConfig(input?: Partial<HouseholdEngineConfig>): HouseholdEngineConfig {
  const merged: HouseholdEngineConfig = {
    ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG,
    ...input,
    utilities: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.utilities, ...((input as any)?.utilities || {}) },
    transport: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.transport, ...(input?.transport || {}) },
    allowances: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.allowances, ...(input?.allowances || {}) },
    obligations: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.obligations, ...(input?.obligations || {}) },
    requiredExpenses: {
      ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.requiredExpenses,
      ...((input as any)?.maintenance ? {
        annualReserveEnabled: Boolean((input as any).maintenance.houseAnnualEnabled),
        annualReserveAmount: Number((input as any).maintenance.houseAnnualAmount || 0),
        semiAnnualReserveEnabled: Boolean((input as any).maintenance.carAnnualEnabled),
        semiAnnualReserveAmount: Number((input as any).maintenance.carAnnualAmount || 0),
        monthlyRequiredEnabled: Boolean((input as any).maintenance.otherMonthlyEnabled),
        monthlyRequiredAmount: Number((input as any).maintenance.otherMonthlyAmount || 0),
      } : {}),
      ...((input as any)?.requiredExpenses || {}),
    },
    bucketRules: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG.bucketRules, ...(input?.bucketRules || {}) },
    autoRouteGoalPriority: Array.isArray(input?.autoRouteGoalPriority) && input.autoRouteGoalPriority.length > 0
      ? input.autoRouteGoalPriority
      : DEFAULT_HOUSEHOLD_ENGINE_CONFIG.autoRouteGoalPriority,
  };

  const mode = merged.operatingMode || 'Balanced';
  if (mode === 'Aggressive Goal') {
    merged.bucketRules.goalSavings = { ...merged.bucketRules.goalSavings, minPctOfSalary: 0.14 };
    merged.bucketRules.investing = { ...merged.bucketRules.investing, minPctOfSalary: 0.02 };
  } else if (mode === 'Protection First') {
    merged.bucketRules.emergencySavings = { ...merged.bucketRules.emergencySavings, minPctOfSalary: 0.12 };
    merged.bucketRules.reserveSavings = { ...merged.bucketRules.reserveSavings, minPctOfSalary: 0.08 };
    merged.bucketRules.goalSavings = { ...merged.bucketRules.goalSavings, minPctOfSalary: 0.03 };
  } else if (mode === 'Growth/Investing Support') {
    merged.bucketRules.investing = { ...merged.bucketRules.investing, minPctOfSalary: 0.1 };
    merged.bucketRules.goalSavings = { ...merged.bucketRules.goalSavings, minPctOfSalary: 0.04 };
  }

  return merged;
}

function resolveGoal(priority: string[], goals: Array<{ name: string; remaining: number }>): { name?: string; remaining: number } {
  const openGoals = goals.filter((g) => Number(g.remaining) > 0);
  if (openGoals.length === 0) return { remaining: 0 };
  for (const preferred of priority) {
    const match = openGoals.find((g) => g.name.toLowerCase().includes(preferred.toLowerCase()));
    if (match) return { name: match.name, remaining: match.remaining };
  }
  const sorted = [...openGoals].sort((a, b) => b.remaining - a.remaining);
  return { name: sorted[0].name, remaining: sorted[0].remaining };
}

export function buildHouseholdBudgetPlan(input: HouseholdEngineInput): HouseholdEngineResult {
  const config = mergeConfig(input.config);
  const monthlySalaryPlan = Array.from({ length: 12 }, (_, i) => toCurrency(input.monthlySalaryPlan[i] || 0));
  const monthlyActualIncome = Array.from({ length: 12 }, (_, i) => toCurrency(input.monthlyActualIncome?.[i] || 0));
  const monthlyActualExpense = Array.from({ length: 12 }, (_, i) => toCurrency(input.monthlyActualExpense?.[i] || 0));
  const overridesMap = new Map((input.monthlyOverrides || []).map((o) => [o.month, o]));

  const reserveMonthlyObligation = toCurrency((config.obligations.annual / 12) + (config.obligations.semiAnnual / 6));
  const annualRequiredMonthly = config.requiredExpenses.annualReserveEnabled ? toCurrency(config.requiredExpenses.annualReserveAmount / 12) : 0;
  const semiAnnualRequiredMonthly = config.requiredExpenses.semiAnnualReserveEnabled ? toCurrency(config.requiredExpenses.semiAnnualReserveAmount / 6) : 0;
  const monthlyRequiredOther = config.requiredExpenses.monthlyRequiredEnabled ? toCurrency(config.requiredExpenses.monthlyRequiredAmount) : 0;
  const goals = (input.goals || []).map((g) => ({ name: g.name, remaining: toCurrency(g.remaining) }));

  const annualBuckets: Record<HouseholdBucketKey, number> = {
    fixedObligations: 0,
    householdEssentials: 0,
    householdOperations: 0,
    transport: 0,
    personalSupport: 0,
    reserveSavings: 0,
    emergencySavings: 0,
    goalSavings: 0,
    kidsFutureSavings: 0,
    retirementSavings: 0,
    investing: 0,
  };

  let remainingEmergencyGap = Math.max(0, toCurrency(input.monthlyActualExpense?.[0] || monthlySalaryPlan[0]) * config.emergencyTargetMonths - toCurrency(input.emergencyBalance));
  let remainingReserveGap = Math.max(0, reserveMonthlyObligation * config.reserveTargetMonths - toCurrency(input.reserveBalance));
  let reservePoolBalance = toCurrency(input.reserveBalance);

  const months: HouseholdMonthPlan[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const override = overridesMap.get(month);
    const adults = Math.max(1, Math.round(override?.adults ?? input.householdDefaults.adults ?? 1));
    const kids = Math.max(0, Math.round(override?.kids ?? input.householdDefaults.kids ?? 0));
    const salary = toCurrency(override?.salary ?? monthlySalaryPlan[index]);

    const buckets: Record<HouseholdBucketKey, number> = {
      fixedObligations: 0,
      householdEssentials: 0,
      householdOperations: 0,
      transport: 0,
      personalSupport: 0,
      reserveSavings: 0,
      emergencySavings: 0,
      goalSavings: 0,
      kidsFutureSavings: 0,
      retirementSavings: 0,
      investing: 0,
    };

    const warnings: string[] = [];
    const validationErrors: string[] = [];

    buckets.fixedObligations = toCurrency((override?.fixedObligations ?? config.obligations.monthlyFixed) + reserveMonthlyObligation + annualRequiredMonthly + semiAnnualRequiredMonthly);
    buckets.householdEssentials = toCurrency(override?.essentials ?? (1500 + adults * 1000 + kids * 650));
    const utilityLoad = config.utilities.baseMonthly + adults * config.utilities.perAdultLoad + kids * config.utilities.perKidLoad;
    const unusualExtra = toCurrency(override?.unusualMonthExtra || 0);
    buckets.householdOperations = config.bucketRules.householdOperations.enabled
      ? toCurrency(Math.max(salary * (config.bucketRules.householdOperations.minPctOfSalary || 0), 400 + kids * 140) + monthlyRequiredOther + utilityLoad + unusualExtra)
      : 0;
    const rideSupport = override?.rideSupportOverride != null ? toCurrency(override.rideSupportOverride) : (config.transport.rideSupportEnabled ? config.transport.rideSupportCost : 0);
    buckets.transport = config.bucketRules.transport.enabled ? toCurrency(config.transport.singleDriverBaseCost + rideSupport) : 0;

    if (config.bucketRules.personalSupport.enabled) {
      const spouse = config.allowances.spouseFixedEnabled ? config.allowances.spouseFixedAmount : 0;
      const personal = config.allowances.personalAllowanceEnabled ? adults * config.allowances.personalAllowancePerAdult : 0;
      buckets.personalSupport = toCurrency(spouse + personal);
    }

    const baseOutflow = Object.values(buckets).reduce((s, v) => s + v, 0);
    let remaining = salary - baseOutflow;

    if (remaining < 0) {
      // affordability-critical mode: reduce flexible buckets first
      const deficit = Math.abs(remaining);
      let toRecover = deficit;
      const cut = (key: HouseholdBucketKey) => {
        const current = buckets[key];
        if (current <= 0 || toRecover <= 0) return;
        const reduce = Math.min(current, toRecover);
        buckets[key] = toCurrency(current - reduce);
        toRecover = toCurrency(toRecover - reduce);
      };
      cut('personalSupport');
      cut('transport');
      cut('householdOperations');
      remaining = salary - Object.values(buckets).reduce((s, v) => s + v, 0);
    }

    const assignBucket = (key: HouseholdBucketKey, target: number) => {
      if (!config.bucketRules[key].enabled || target <= 0 || remaining <= 0) return;
      const allocated = Math.min(remaining, target);
      buckets[key] = toCurrency(buckets[key] + allocated);
      remaining -= allocated;
    };

    assignBucket('reserveSavings', Math.max(remainingReserveGap > 0 ? remainingReserveGap / (13 - month) : 0, salary * (config.bucketRules.reserveSavings.minPctOfSalary || 0)));
    remainingReserveGap = Math.max(0, remainingReserveGap - buckets.reserveSavings);

    assignBucket('emergencySavings', Math.max(remainingEmergencyGap > 0 ? remainingEmergencyGap / (13 - month) : 0, salary * (config.bucketRules.emergencySavings.minPctOfSalary || 0)));
    remainingEmergencyGap = Math.max(0, remainingEmergencyGap - buckets.emergencySavings);

    assignBucket('kidsFutureSavings', kids > 0 ? Math.max(salary * (config.bucketRules.kidsFutureSavings.minPctOfSalary || 0), kids * 250) : 0);
    assignBucket('retirementSavings', salary * (config.bucketRules.retirementSavings.minPctOfSalary || 0));
    assignBucket('investing', salary * (config.bucketRules.investing.minPctOfSalary || 0));

    const activeGoal = resolveGoal(config.autoRouteGoalPriority, goals);
    assignBucket('goalSavings', Math.max(salary * (config.bucketRules.goalSavings.minPctOfSalary || 0), Math.min(activeGoal.remaining, Math.max(0, remaining))));

    const routedGoalName = activeGoal.name;
    const routedGoalAmount = toCurrency(remaining > 0 ? remaining : 0);
    if (routedGoalName && routedGoalAmount > 0) {
      const goal = goals.find((g) => g.name === routedGoalName);
      if (goal) goal.remaining = Math.max(0, goal.remaining - routedGoalAmount - buckets.goalSavings);
    }

    // due-month deductions from reserve pool
    reservePoolBalance = toCurrency(reservePoolBalance + buckets.reserveSavings);
    const dueMonths = new Set<number>(config.obligations.semiAnnualDueMonths || []);
    let dueDeduction = 0;
    if ((config.obligations.annualDueMonth || 12) === month) dueDeduction += toCurrency(config.obligations.annual);
    if (dueMonths.has(month)) dueDeduction += toCurrency(config.obligations.semiAnnual);
    if (dueDeduction > 0) {
      reservePoolBalance = toCurrency(reservePoolBalance - dueDeduction);
      if (reservePoolBalance < 0) {
        warnings.push(`Reserve pool underfunded after due-month deduction (${dueDeduction.toLocaleString()}).`);
      }
    }

    if (salary <= 0) warnings.push('No salary planned: non-essential allocations are auto-frozen.');
    const pressureRatio = salary > 0 ? (Object.values(buckets).reduce((s, v) => s + v, 0) / salary) : 1;
    if (pressureRatio > 1) warnings.push('Affordability pressure: required allocations exceed salary. Reduce optional buckets.');
    if (remainingEmergencyGap > 0 && month > 6) warnings.push('Emergency target is still behind plan after mid-year.');
    const totalPlannedOutflow = toCurrency(Object.values(buckets).reduce((s, v) => s + v, 0) + routedGoalAmount);
    if (salary < Object.values(buckets).reduce((s, v) => s + v, 0)) {
      validationErrors.push('Over-allocation rejected: protected + base allocations exceed salary.');
    }
    if (salary - totalPlannedOutflow < 0) validationErrors.push('Negative remainder detected for this month.');
    if (remainingReserveGap > 0 && month > 6) validationErrors.push('Reserve gap remains underfunded after mid-year.');

    const incomeActual = monthlyActualIncome[index];
    const totalActualOutflow = monthlyActualExpense[index];

    return {
      month,
      adults,
      kids,
      incomePlanned: salary,
      incomeActual,
      totalPlannedOutflow,
      totalActualOutflow,
      plannedNet: round2(salary - totalPlannedOutflow),
      actualNet: round2(incomeActual - totalActualOutflow),
      routedGoalName,
      routedGoalAmount,
      reservePoolAfterDeductions: reservePoolBalance,
      buckets,
      validationErrors,
      warnings,
    };
  });

  months.forEach((m) => {
    (Object.keys(annualBuckets) as HouseholdBucketKey[]).forEach((k) => {
      annualBuckets[k] = toCurrency(annualBuckets[k] + m.buckets[k]);
    });
  });

  const plannedIncome = toCurrency(months.reduce((s, m) => s + m.incomePlanned, 0));
  const actualIncome = toCurrency(months.reduce((s, m) => s + m.incomeActual, 0));
  const plannedOutflow = toCurrency(months.reduce((s, m) => s + m.totalPlannedOutflow, 0));
  const actualOutflow = toCurrency(months.reduce((s, m) => s + m.totalActualOutflow, 0));
  const plannedNet = round2(plannedIncome - plannedOutflow);
  const actualNet = round2(actualIncome - actualOutflow);

  const recommendations: string[] = [];
  if (plannedNet < 0) recommendations.push('Planned year ends negative. Freeze optional categories and reduce personal support first.');
  if (remainingEmergencyGap > 0) recommendations.push(`Emergency fund is short by ${round2(remainingEmergencyGap).toLocaleString()}. Keep emergency bucket protected.`);
  if (remainingEmergencyGap <= 0 && (input.monthlyActualIncome?.some((v) => v > 0) ?? false)) {
    recommendations.push('Emergency fund target is on track. Keep contributing to maintain the buffer.');
  }
  const pressureMonths = months.filter((m) => m.warnings.length > 0).length;
  if (pressureMonths > 0) recommendations.push(`${pressureMonths} month(s) under pressure. Apply monthly overrides only for salary and essentials.`);
  if (months.some((m) => (m.routedGoalAmount + m.buckets.goalSavings) > 0 && m.routedGoalName)) {
    recommendations.push('Surplus is auto-routed to your top-priority goal. Adjust goal order in Goals to change priority.');
  }
  const monthlyForVariance = input.monthlyActualIncome ?? input.monthlySalaryPlan;
  const suggested = suggestProfileFromIncomeVariance(monthlyForVariance);
  if (suggested) recommendations.push('Income varies month-to-month; consider switching to Conservative profile for more safety.');

  return {
    config,
    months,
    annualBuckets,
    recommendations,
    suggestedProfile: suggested ?? undefined,
    plannedVsActual: { plannedIncome, actualIncome, plannedOutflow, actualOutflow, plannedNet, actualNet },
    balanceProjection: {
      openingLiquid: toCurrency(input.liquidBalance),
      projectedYearEndLiquid: toCurrency(input.liquidBalance + plannedNet),
    },
  };
}
