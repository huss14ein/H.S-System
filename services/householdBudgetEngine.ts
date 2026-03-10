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
  emergencyTargetMonths: number;
  reserveTargetMonths: number;
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
  buckets: Record<HouseholdBucketKey, number>;
  warnings: string[];
}

export interface HouseholdEngineResult {
  config: HouseholdEngineConfig;
  months: HouseholdMonthPlan[];
  annualBuckets: Record<HouseholdBucketKey, number>;
  recommendations: string[];
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
  emergencyTargetMonths: 6,
  reserveTargetMonths: 2,
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
  return {
    ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG,
    ...input,
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

    buckets.fixedObligations = toCurrency((override?.fixedObligations ?? config.obligations.monthlyFixed) + reserveMonthlyObligation + annualRequiredMonthly + semiAnnualRequiredMonthly);
    buckets.householdEssentials = toCurrency(override?.essentials ?? (1500 + adults * 1000 + kids * 650));
    buckets.householdOperations = config.bucketRules.householdOperations.enabled ? toCurrency(Math.max(salary * (config.bucketRules.householdOperations.minPctOfSalary || 0), 400 + kids * 140) + monthlyRequiredOther) : 0;
    buckets.transport = config.bucketRules.transport.enabled ? toCurrency(config.transport.singleDriverBaseCost + (config.transport.rideSupportEnabled ? config.transport.rideSupportCost : 0)) : 0;

    if (config.bucketRules.personalSupport.enabled) {
      const spouse = config.allowances.spouseFixedEnabled ? config.allowances.spouseFixedAmount : 0;
      const personal = config.allowances.personalAllowanceEnabled ? adults * config.allowances.personalAllowancePerAdult : 0;
      buckets.personalSupport = toCurrency(spouse + personal);
    }

    let remaining = salary - Object.values(buckets).reduce((s, v) => s + v, 0);

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

    if (salary <= 0) warnings.push('No salary planned: non-essential allocations are auto-frozen.');
    const pressureRatio = salary > 0 ? (Object.values(buckets).reduce((s, v) => s + v, 0) / salary) : 1;
    if (pressureRatio > 1) warnings.push('Affordability pressure: required allocations exceed salary. Reduce optional buckets.');
    if (remainingEmergencyGap > 0 && month > 6) warnings.push('Emergency target is still behind plan after mid-year.');

    const totalPlannedOutflow = toCurrency(Object.values(buckets).reduce((s, v) => s + v, 0) + routedGoalAmount);
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
      buckets,
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
  const pressureMonths = months.filter((m) => m.warnings.length > 0).length;
  if (pressureMonths > 0) recommendations.push(`${pressureMonths} month(s) under pressure. Apply monthly overrides only for salary and essentials.`);
  if (months.some((m) => (m.routedGoalAmount + m.buckets.goalSavings) > 0 && m.routedGoalName)) {
    recommendations.push('Remaining salary is auto-routed to the active goal based on configured priority.');
  }
    recommendations.push(`Required-expense coverage: annual reserve ${annualRequiredMonthly.toLocaleString()}/mo, semiannual reserve ${semiAnnualRequiredMonthly.toLocaleString()}/mo, other required ${monthlyRequiredOther.toLocaleString()}/mo.`);

  return {
    config,
    months,
    annualBuckets,
    recommendations,
    plannedVsActual: { plannedIncome, actualIncome, plannedOutflow, actualOutflow, plannedNet, actualNet },
    balanceProjection: {
      openingLiquid: toCurrency(input.liquidBalance),
      projectedYearEndLiquid: toCurrency(input.liquidBalance + plannedNet),
    },
  };
}
