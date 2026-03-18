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

export type HouseholdEngineProfile = 'Moderate' | 'Conservative' | 'Aggressive' | 'Growth' | string;

/** Profile labels and descriptions for UI (e.g. Budgets household engine selector). */
export const HOUSEHOLD_ENGINE_PROFILES: Record<HouseholdEngineProfile, { label: string; description: string }> = {
  Moderate: { label: 'Moderate', description: 'Balanced savings and spending. Good for stable income and medium-term goals.' },
  Conservative: { label: 'Conservative', description: 'Higher emergency and reserve allocation. Prioritizes safety and liquidity.' },
  Aggressive: { label: 'Aggressive', description: 'More toward goals and investing. Suited for higher risk tolerance.' },
  Growth: { label: 'Growth', description: 'Similar to Aggressive; maximizes goal and investment allocation.' },
};

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

/** Suggested budget entry from the household engine (unified bulk-add categories). */
export interface HouseholdBudgetCategorySuggestion {
  category: string;
  limit: number;
  period: 'monthly' | 'yearly' | 'weekly' | 'daily';
  tier: 'Core' | 'Supporting' | 'Optional';
  /** Optional short description for UI. */
  hint?: string;
}

/** @deprecated Use HouseholdBudgetCategorySuggestion. */
export type SaudiBudgetCategorySuggestion = HouseholdBudgetCategorySuggestion;

/** KSA expense category descriptions for UI help text and dropdowns. */
export const KSA_EXPENSE_CATEGORY_HINTS: Record<string, string> = {
  'Housing Rent (Monthly)': 'If paid monthly; common in newer apartments.',
  'Groceries & Supermarket': 'Food, toiletries, and cleaning supplies.',
  'Utilities': 'Electricity (SEC), Water (NWC). Note: Electricity spikes in summer.',
  'Telecommunications': 'Home Fiber/5G internet and mobile data plans.',
  'Transportation': 'Petrol/Fuel, Riyadh Metro pass, or Uber/Careem budget.',
  'Domestic Help': 'Salary for live-in housemaids or drivers.',
  'Dining & Entertainment': 'Restaurants, cafes, and streaming (Netflix/Shahid).',
  'Insurance Co-pay': 'Small fees paid at clinics during doctor visits.',
  'Debt/Loans': 'Personal loan installments or credit card minimums.',
  'Remittances': 'Funds sent to family outside KSA (for expats).',
  'Pocket Money': 'Cash for small daily needs (tea, snacks, parking).',
  'Housing Rent (Semi-Annual)': 'Most common in KSA: 2 checks per year.',
  'School Tuition (Semester)': 'Private/international school fees per semester.',
  'Bulk Household Maintenance': 'AC cleaning/servicing before and after summer.',
  'Iqama Renewal': 'Government fee for residency (expats).',
  'Dependent Fees': 'Total annual cost for family members (e.g. SAR 4,800 per person).',
  'Exit/Re-entry Visa': 'For vacations outside the Kingdom.',
  'Vehicle Insurance': 'Mandatory TPL or comprehensive insurance.',
  'Istimara (Registration)': 'Car registration renewal (every 3 years, often budgeted yearly).',
  'Fahas (MVPI)': 'Annual periodic vehicle inspection fee.',
  'School Uniforms & Books': 'Typically one-time in August/September.',
  'Zakat': 'Religious almsgiving (usually 2.5% of eligible wealth).',
  'Annual Vacation': 'Flights and travel for home leave or holidays.',
  'Fresh Produce (Weekly)': 'Fruit, vegetables, bread from local markets (Souqs).',
  'Household Help (Hourly)': 'Hourly cleaning (e.g. Mudarri or Java).',
  'Leisure (Weekly)': 'Weekend outings, cinema, or family gatherings.',
};

/** Household-engine budget categories with suggested limits from household size and salary.
 * Single source for bulk-add; covers monthly, yearly, weekly. */
export function generateHouseholdBudgetCategories(
  adults: number,
  kids: number,
  monthlySalary: number,
  profile: HouseholdEngineProfile
): HouseholdBudgetCategorySuggestion[] {
  const baseExpense = monthlySalary > 0 ? monthlySalary * 0.6 : 5000;
  const income = monthlySalary > 0 ? monthlySalary * 12 : 60000;
  const pct = (x: number) => Math.round(baseExpense * x);
  const savingsMultiplier = profile === 'Conservative' ? 1.2 : profile === 'Aggressive' || profile === 'Growth' ? 0.85 : 1;
  const result: HouseholdBudgetCategorySuggestion[] = [];

  // ——— Monthly (recurring, every 30 days) ———
  result.push({ category: 'Housing Rent (Monthly)', limit: pct(0.30), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Housing Rent (Monthly)'] });
  // Groceries: conservative Saudi-specific baseline.
  // Start from a low base percent and scale with adults and kids, then clamp to a safe band.
  const extraAdults = Math.max(adults - 1, 0);
  const groceriesPctRaw = 0.06 + extraAdults * 0.015 + kids * 0.012;
  const groceriesPct = Math.max(0.06, Math.min(groceriesPctRaw, 0.14)); // 6%–14% of baseExpense
  result.push({
    category: 'Groceries & Supermarket',
    limit: pct(groceriesPct),
    period: 'monthly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Groceries & Supermarket'],
  });
  result.push({ category: 'Utilities', limit: pct(0.08), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Utilities'] });
  result.push({ category: 'Telecommunications', limit: pct(0.04), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Telecommunications'] });
  result.push({ category: 'Transportation', limit: pct(0.10), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Transportation'] });
  result.push({ category: 'Domestic Help', limit: pct(0.08), period: 'monthly', tier: 'Supporting', hint: KSA_EXPENSE_CATEGORY_HINTS['Domestic Help'] });
  result.push({ category: 'Dining & Entertainment', limit: pct(0.06), period: 'monthly', tier: 'Optional', hint: KSA_EXPENSE_CATEGORY_HINTS['Dining & Entertainment'] });
  result.push({ category: 'Insurance Co-pay', limit: pct(0.02), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Insurance Co-pay'] });
  result.push({ category: 'Debt/Loans', limit: pct(0.05), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Debt/Loans'] });
  result.push({ category: 'Remittances', limit: pct(0.08), period: 'monthly', tier: 'Supporting', hint: KSA_EXPENSE_CATEGORY_HINTS['Remittances'] });
  result.push({ category: 'Pocket Money', limit: pct(0.02), period: 'monthly', tier: 'Optional', hint: KSA_EXPENSE_CATEGORY_HINTS['Pocket Money'] });
  result.push({ category: 'Savings & Investments', limit: Math.round(pct(0.15) * savingsMultiplier), period: 'monthly', tier: 'Core' });
  result.push({ category: 'Health', limit: pct(0.02), period: 'monthly', tier: 'Core' });
  result.push({ category: 'Personal Care', limit: pct(0.03), period: 'monthly', tier: 'Supporting' });
  result.push({ category: 'Shopping', limit: pct(0.03), period: 'monthly', tier: 'Optional' });
  result.push({ category: 'Miscellaneous', limit: pct(0.02), period: 'monthly', tier: 'Optional' });
  if (kids > 0) {
    result.push({ category: 'School & Children', limit: pct(0.10) + kids * 500, period: 'monthly', tier: 'Core' });
  }

  // ——— 6-Month (semi-annual): store as yearly, limit = total per year (2 payments) ———
  const semiAnnualRent = Math.round(baseExpense * 0.30 * 2);
  result.push({ category: 'Housing Rent (Semi-Annual)', limit: semiAnnualRent, period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Housing Rent (Semi-Annual)'] });
  result.push({ category: 'School Tuition (Semester)', limit: Math.round(baseExpense * 0.10 * 2), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['School Tuition (Semester)'] });
  result.push({ category: 'Bulk Household Maintenance', limit: Math.round(baseExpense * 0.03 * 2), period: 'yearly', tier: 'Supporting', hint: KSA_EXPENSE_CATEGORY_HINTS['Bulk Household Maintenance'] });

  // ——— Yearly (sinking fund: save a bit each month) ———
  result.push({ category: 'Iqama Renewal', limit: Math.round(income * 0.02), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Iqama Renewal'] });
  result.push({ category: 'Dependent Fees', limit: (adults + kids) * 4800, period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Dependent Fees'] });
  result.push({ category: 'Exit/Re-entry Visa', limit: Math.round(income * 0.01), period: 'yearly', tier: 'Supporting', hint: KSA_EXPENSE_CATEGORY_HINTS['Exit/Re-entry Visa'] });
  result.push({ category: 'Vehicle Insurance', limit: Math.round(income * 0.03), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Vehicle Insurance'] });
  result.push({ category: 'Istimara (Registration)', limit: Math.round(income * 0.01), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Istimara (Registration)'] });
  result.push({ category: 'Fahas (MVPI)', limit: Math.round(income * 0.005), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Fahas (MVPI)'] });
  if (kids > 0) {
    result.push({ category: 'School Uniforms & Books', limit: kids * 2000, period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['School Uniforms & Books'] });
  }
  result.push({ category: 'Zakat', limit: Math.round(income * 0.025), period: 'yearly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Zakat'] });
  result.push({ category: 'Annual Vacation', limit: Math.round(income * 0.08), period: 'yearly', tier: 'Optional', hint: KSA_EXPENSE_CATEGORY_HINTS['Annual Vacation'] });

  // ——— Weekly ———
  result.push({ category: 'Fresh Produce (Weekly)', limit: Math.round((baseExpense * 0.03) / 4.33), period: 'weekly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Fresh Produce (Weekly)'] });
  result.push({ category: 'Household Help (Hourly)', limit: Math.round((baseExpense * 0.02) / 4.33), period: 'weekly', tier: 'Supporting', hint: KSA_EXPENSE_CATEGORY_HINTS['Household Help (Hourly)'] });
  result.push({ category: 'Leisure (Weekly)', limit: Math.round((baseExpense * 0.02) / 4.33), period: 'weekly', tier: 'Optional', hint: KSA_EXPENSE_CATEGORY_HINTS['Leisure (Weekly)'] });

  return result;
}

/** @deprecated Use generateHouseholdBudgetCategories. */
export const generateSaudiBudgetCategories = generateHouseholdBudgetCategories;

/** Build household engine input from plan-style arrays (e.g. Plan page). */
export function buildHouseholdEngineInputFromPlanData(
  monthlyIncomePlanned: number[],
  monthlyIncomeActual: number[],
  monthlyExpenseActual: number[],
  accounts: Array<{ type?: string; balance?: number }>,
  goals: Array<{ id?: string; name?: string; targetAmount?: number; currentAmount?: number; deadline?: string }>,
  options: {
    expectedMonthlySalary?: number;
    adults?: number;
    kids?: number;
    profile?: HouseholdEngineProfile;
    monthlyOverrides?: HouseholdMonthlyOverride[];
    config?: HouseholdEngineConfig;
  }
): HouseholdBudgetPlanInput {
  const salary = options?.expectedMonthlySalary ?? (monthlyIncomePlanned?.length ? monthlyIncomePlanned.reduce((a, b) => a + b, 0) / monthlyIncomePlanned.length : 0);
  const monthlySalaryPlan = Array.isArray(monthlyIncomePlanned) && monthlyIncomePlanned.length >= 12
    ? monthlyIncomePlanned.slice(0, 12)
    : Array(12).fill(salary);
  const monthlyActualIncome = Array.isArray(monthlyIncomeActual) && monthlyIncomeActual.length >= 12
    ? monthlyIncomeActual.slice(0, 12)
    : Array(12).fill(0);
  const monthlyActualExpense = Array.isArray(monthlyExpenseActual) && monthlyExpenseActual.length >= 12
    ? monthlyExpenseActual.slice(0, 12)
    : Array(12).fill(0);
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

  // Calculate expense category allocations based on household size and income (KSA-specific)
  const getExpenseAllocations = (income: number, expense: number, monthIndex: number) => {
    const override = monthlyOverrides.find(o => (o.monthIndex === monthIndex || o.month === monthIndex + 1));
    const baseExpense = expense || (income * 0.6); // Default 60% of income for expenses if no expense data
    
    // KSA-specific monthly expense allocations (as percentages of total monthly expenses)
    const allocations: Record<string, number> = {
      // Monthly Recurring Expenses
      housing: baseExpense * 0.30,      // 30% - Housing Rent (if paid monthly)
      groceries: baseExpense * (0.12 + (adults * 0.04) + (kids * 0.02)), // 12% base + per person - Groceries & Supermarket
      utilities: baseExpense * 0.08,     // 8% - Electricity (SEC), Water (NWC) - spikes in summer
      telecommunications: baseExpense * 0.04, // 4% - Home Fiber/5G internet and Mobile data plans
      transportation: baseExpense * 0.10, // 10% - Petrol/Fuel, Riyadh Metro, Uber/Careem
      domesticHelp: baseExpense * 0.08,  // 8% - Salary for live-in housemaids or drivers
      diningEntertainment: baseExpense * 0.06, // 6% - Restaurants, cafes, streaming (Netflix/Shahid)
      insuranceCoPay: baseExpense * 0.02, // 2% - Small fees at clinics during doctor visits
      debtLoans: baseExpense * 0.05,    // 5% - Personal loan installments or Credit Card minimums
      remittances: baseExpense * 0.08,   // 8% - Funds sent to family outside KSA (for expats)
      pocketMoney: baseExpense * 0.02,   // 2% - Cash for small daily needs (tea, snacks, parking)
      
      // Legacy category mappings for backward compatibility
      food: baseExpense * (0.12 + (adults * 0.04) + (kids * 0.02)), // Alias for groceries
      health: baseExpense * 0.02,        // Alias for insuranceCoPay
      personalCare: baseExpense * 0.03,  // 3% - Grooming, hygiene (part of groceries)
      entertainment: baseExpense * 0.06,  // Alias for diningEntertainment
      shopping: baseExpense * 0.03,       // 3% - Clothing, household items
      miscellaneous: baseExpense * 0.02,  // 2% - Other expenses
    };

    // Semi-Annual Expenses (6-month) - allocate monthly sinking fund
    // These are divided by 6 to get monthly allocation
    const semiAnnualExpenses = {
      housingSemiAnnual: (baseExpense * 0.30) / 6, // Housing Rent (2 checks per year)
      schoolTuition: (baseExpense * 0.10) / 6,     // School fees per semester (if applicable)
      householdMaintenance: (baseExpense * 0.03) / 6, // AC cleaning/servicing before and after summer
    };
    Object.assign(allocations, semiAnnualExpenses);

    // Annual Expenses - allocate monthly sinking fund (divided by 12)
    const annualExpenses = {
      iqamaRenewal: (income * 0.02) / 12,          // Government fee for residency (expats)
      dependentFees: (kids * 4800) / 12,           // SAR 4,800 per person per year
      exitReentryVisa: (income * 0.01) / 12,       // For vacations outside the Kingdom
      vehicleInsurance: (income * 0.03) / 12,     // Mandatory TPL or Comprehensive insurance
      istimara: (income * 0.01) / 12,              // Car registration renewal (every 3 years, budgeted yearly)
      fahas: (income * 0.005) / 12,                // Annual periodic vehicle inspection fee
      schoolUniformsBooks: (kids * 2000) / 12,     // Typically in August/September
      zakat: (income * 0.025) / 12,                // Religious almsgiving (2.5% of annual savings)
      annualVacation: (income * 0.08) / 12,         // Flights and travel expenses
    };
    Object.assign(allocations, annualExpenses);

    // Weekly Expenses - convert to monthly (multiply by 4.33)
    const weeklyExpenses = {
      freshProduce: (baseExpense * 0.03) * 4.33,   // Fruit, vegetables, bread from local markets
      householdHelpHourly: (baseExpense * 0.02) * 4.33, // Hourly cleaning services (Mudarri or Java)
      leisureWeekly: (baseExpense * 0.02) * 4.33,  // Weekend outings, cinema, family gatherings
    };
    Object.assign(allocations, weeklyExpenses);

    // Apply overrides if present
    if (override?.expenseAdjustment) {
      const adjustment = override.expenseAdjustment;
      Object.keys(allocations).forEach(key => {
        allocations[key] = allocations[key] * (1 + adjustment / 100);
      });
    }

    // Apply summer utility spike (June, July, August in KSA - months 6, 7, 8)
    if (monthIndex >= 5 && monthIndex <= 7) {
      allocations.utilities = allocations.utilities * 1.5; // 50% increase in summer
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
    
    // 3. Emergency savings (priority 1) - Fixed division by zero and overflow
    const monthsRemaining = Math.max(1, 12 - i);
    const emergencyGapPerMonth = remainingEmergencyGap > 0 ? remainingEmergencyGap / monthsRemaining : 0;
    const emergencyFromProfile = availableForSavings * profilePcts.emergencySavings;
    const emergencyTarget = remainingEmergencyGap > 0 
      ? Math.min(emergencyFromProfile, emergencyGapPerMonth, availableForSavings) // Ensure we don't exceed available
      : availableForSavings * profilePcts.emergencySavings * 0.5; // Maintain 50% of allocation even when funded
    buckets.emergencySavings = Math.max(0, Math.min(Math.round(emergencyTarget), availableForSavings));
    remainingEmergencyGap = Math.max(0, remainingEmergencyGap - buckets.emergencySavings);
    
    // 4. Reserve savings (priority 2) - Fixed division by zero
    const remainingAfterEmergency = Math.max(0, availableForSavings - buckets.emergencySavings);
    const reserveGapPerMonth = remainingReserveGap > 0 ? remainingReserveGap / monthsRemaining : 0;
    const reserveFromProfile = remainingAfterEmergency * profilePcts.reserveSavings;
    const reserveTarget = remainingReserveGap > 0
      ? Math.min(reserveFromProfile, reserveGapPerMonth, remainingAfterEmergency)
      : reserveFromProfile;
    buckets.reserveSavings = Math.max(0, Math.min(Math.round(reserveTarget), remainingAfterEmergency));
    remainingReserveGap = Math.max(0, remainingReserveGap - buckets.reserveSavings);
    
    // 5. Goal savings (priority 3) - Fixed division by zero
    const remainingAfterReserve = Math.max(0, remainingAfterEmergency - buckets.reserveSavings);
    if (activeGoal && operatingMode !== 'Protection First') {
      const goalRemaining = Math.max(0, activeGoal.targetAmount - activeGoal.currentAmount);
      const goalGapPerMonth = goalRemaining / monthsRemaining;
      const goalFromProfile = remainingAfterReserve * profilePcts.goalSavings;
      const goalAllocation = Math.min(goalFromProfile, goalGapPerMonth, remainingAfterReserve);
      buckets.goalSavings = Math.max(0, Math.min(Math.round(goalAllocation), remainingAfterReserve));
    } else {
      buckets.goalSavings = Math.max(0, Math.min(Math.round(remainingAfterReserve * profilePcts.goalSavings), remainingAfterReserve));
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
    
    // Update cumulative liquid balance - account for bucket allocations reducing available cash
    const totalBucketAllocations = Object.values(buckets).reduce((sum, val) => sum + (val as number), 0);
    const netCashFlow = surplus - (totalBucketAllocations - expenseAllocations.housing - expenseAllocations.groceries - expenseAllocations.utilities - expenseAllocations.transportation - expenseAllocations.health - expenseAllocations.personalCare - expenseAllocations.entertainment - expenseAllocations.shopping - expenseAllocations.miscellaneous);
    cumulativeLiquid = Math.max(0, cumulativeLiquid + netCashFlow);
    
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
      expenseActual: Number(monthlyActualExpense[i] ?? exp),
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
      totalPlannedOutflow: exp + Object.values(buckets).filter(() => {
        // Only count savings buckets, not expense buckets (expenses already in exp)
        const bucketKeys = Object.keys(buckets);
        const key = bucketKeys[Object.values(buckets).indexOf(_)];
        return key && (key.includes('Savings') || key === 'investing' || key === 'retirementSavings' || key === 'kidsFutureSavings');
      }).reduce((a, b) => a + (b as number), 0),
      totalActualOutflow: Number(monthlyActualExpense[i] ?? exp),
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
