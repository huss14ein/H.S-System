/**
 * Household Budget Engine: baseline budgets and cashflow signals.
 * Minimal implementation for build compatibility.
 */

import { countsAsExpenseForCashflowKpi, countsAsIncomeForCashflowKpi } from './transactionFilters';

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
  Aggressive: { label: 'Aggressive', description: 'Wider spending envelope and higher risk tolerance; still allocates to goals and investing.' },
  Growth: { label: 'Growth', description: 'Tighter discretionary envelope than Aggressive; prioritizes goals, retirement, and investing over day-to-day spend.' },
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
  'Housing Rent': 'Total rent or mortgage for the year (one yearly budget).',
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

/**
 * How much extra room groceries get vs the neutral profile (after the global +10% bump).
 * Conservative = higher essential-food envelope; Aggressive = leaner; Growth = slightly more room than Aggressive while prioritizing investments elsewhere.
 */
function groceryProfileSpendingMultiplier(profile: HouseholdEngineProfile): number {
  if (profile === 'Conservative') return 1.06;
  if (profile === 'Aggressive') return 0.94;
  if (profile === 'Growth') return 0.96;
  return 1.0;
}

/**
 * Groceries & Supermarket as a share of monthly expense base (`baseExpense`).
 * Base formula scales with adults/kids; then +10% vs legacy; then profile multiplier; clamped.
 */
export function groceryShareOfBaseExpense(
  adults: number,
  kids: number,
  profile: HouseholdEngineProfile
): number {
  const extraAdults = Math.max(adults - 1, 0);
  const raw = 0.06 + extraAdults * 0.015 + kids * 0.012;
  const bumped = raw * 1.1;
  const merged = bumped * groceryProfileSpendingMultiplier(profile);
  return Math.max(0.07, Math.min(merged, 0.22));
}

/** Uplift for Core tier suggested limits (explicit +5% vs prior engine). */
export const CORE_CATEGORY_LIMIT_MULTIPLIER = 1.05;

/** +5% on bulk envelope bases (user request), before household scaling. */
const ENVELOPE_BASE_BUMP = 1.05;

/**
 * Larger households need a larger spending envelope relative to the same income (realistic KSA cost pressure).
 * Reference: 2 adults, 0 kids ≈ 1.0.
 */
export function householdConsumptionScale(adults: number, kids: number): number {
  const a = Math.max(1, Math.floor(adults));
  const k = Math.max(0, Math.floor(kids));
  let m = 1;
  if (a > 2) m += 0.048 * (a - 2);
  if (a < 2) m -= 0.035 * (2 - a);
  m += 0.042 * k;
  return Math.max(0.94, Math.min(1.34, m));
}

/**
 * Monthly expense pool used for category templates and engine buckets when actual spend is unknown.
 * Scales with profile selection indirectly via category tilts; scales with headcount here.
 */
export function effectiveTemplateBaseExpense(monthlySalary: number, adults: number, kids: number): number {
  const scale = householdConsumptionScale(adults, kids);
  const heads = Math.max(1, adults + kids);
  if (monthlySalary > 0) {
    const incomeExpenseShare = Math.min(0.7, 0.6 + 0.012 * Math.max(0, heads - 2) + 0.008 * kids);
    return Math.round(monthlySalary * incomeExpenseShare * scale);
  }
  const floor = Math.max(8200, 5400 + heads * 1850);
  return Math.round(floor * scale);
}

function tierProfileTilt(profile: HouseholdEngineProfile, tier: 'Core' | 'Supporting' | 'Optional'): number {
  if (profile === 'Conservative') {
    if (tier === 'Core') return 1.035;
    if (tier === 'Supporting') return 1.025;
    return 0.965;
  }
  if (profile === 'Aggressive') {
    if (tier === 'Core') return 0.985;
    if (tier === 'Supporting') return 1.045;
    return 1.065;
  }
  if (profile === 'Growth') {
    if (tier === 'Core') return 0.992;
    if (tier === 'Supporting') return 1.03;
    return 1.04;
  }
  return 1;
}

/** Same factors as applyTierUplift but without rounding (for monthly bucket sums). */
export function tierAdjustedAmount(
  raw: number,
  tier: 'Core' | 'Supporting' | 'Optional',
  profile: HouseholdEngineProfile
): number {
  let v = raw * tierProfileTilt(profile, tier);
  if (tier === 'Core') v *= CORE_CATEGORY_LIMIT_MULTIPLIER;
  return Math.max(0, v);
}

function applyTierUplift(
  raw: number,
  tier: 'Core' | 'Supporting' | 'Optional',
  profile: HouseholdEngineProfile
): number {
  return Math.round(tierAdjustedAmount(raw, tier, profile));
}

/** Household-engine budget categories with suggested limits from household size and salary.
 * Single source for bulk-add; covers monthly, yearly, weekly. */
export function generateHouseholdBudgetCategories(
  adults: number,
  kids: number,
  monthlySalary: number,
  profile: HouseholdEngineProfile
): HouseholdBudgetCategorySuggestion[] {
  const baseExpense = effectiveTemplateBaseExpense(monthlySalary, adults, kids);
  const incomeAnnual =
    monthlySalary > 0 ? monthlySalary * 12 : Math.max(72000, Math.round(effectiveTemplateBaseExpense(12000, adults, kids) * 12));
  const income = incomeAnnual;
  const savingsMultiplier =
    profile === 'Conservative' ? 1.2 : profile === 'Growth' ? 0.92 : profile === 'Aggressive' ? 0.85 : 1;
  const result: HouseholdBudgetCategorySuggestion[] = [];

  const pct = (share: number, tier: 'Core' | 'Supporting' | 'Optional') =>
    applyTierUplift(baseExpense * share, tier, profile);

  // ——— Monthly (recurring, every 30 days) ———
  const groceriesPct = groceryShareOfBaseExpense(adults, kids, profile);
  result.push({
    category: 'Groceries & Supermarket',
    limit: applyTierUplift(baseExpense * groceriesPct, 'Core', profile),
    period: 'monthly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Groceries & Supermarket'],
  });
  result.push({ category: 'Utilities', limit: pct(0.08, 'Core'), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Utilities'] });
  result.push({
    category: 'Telecommunications',
    limit: pct(0.04, 'Core'),
    period: 'monthly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Telecommunications'],
  });
  result.push({
    category: 'Transportation',
    limit: pct(0.1, 'Core'),
    period: 'monthly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Transportation'],
  });
  result.push({
    category: 'Domestic Help',
    limit: pct(0.08, 'Supporting'),
    period: 'monthly',
    tier: 'Supporting',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Domestic Help'],
  });
  result.push({
    category: 'Dining & Entertainment',
    limit: pct(0.06, 'Optional'),
    period: 'monthly',
    tier: 'Optional',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Dining & Entertainment'],
  });
  result.push({
    category: 'Insurance Co-pay',
    limit: pct(0.02, 'Core'),
    period: 'monthly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Insurance Co-pay'],
  });
  result.push({ category: 'Debt/Loans', limit: pct(0.05, 'Core'), period: 'monthly', tier: 'Core', hint: KSA_EXPENSE_CATEGORY_HINTS['Debt/Loans'] });
  result.push({
    category: 'Remittances',
    limit: pct(0.08, 'Supporting'),
    period: 'monthly',
    tier: 'Supporting',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Remittances'],
  });
  result.push({
    category: 'Pocket Money',
    limit: pct(0.02, 'Optional'),
    period: 'monthly',
    tier: 'Optional',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Pocket Money'],
  });
  result.push({
    category: 'Savings & Investments',
    limit: Math.round(applyTierUplift(baseExpense * 0.15, 'Core', profile) * savingsMultiplier),
    period: 'monthly',
    tier: 'Core',
  });
  result.push({ category: 'Health', limit: pct(0.02, 'Core'), period: 'monthly', tier: 'Core' });
  result.push({
    category: 'Personal Care',
    limit: pct(0.03, 'Supporting'),
    period: 'monthly',
    tier: 'Supporting',
  });
  result.push({ category: 'Shopping', limit: pct(0.03, 'Optional'), period: 'monthly', tier: 'Optional' });
  result.push({
    category: 'Miscellaneous',
    limit: pct(0.02, 'Optional'),
    period: 'monthly',
    tier: 'Optional',
  });
  if (kids > 0) {
    result.push({
      category: 'School & Children',
      limit: applyTierUplift(baseExpense * 0.1 + kids * 525, 'Core', profile),
      period: 'monthly',
      tier: 'Core',
    });
  }

  // ——— Yearly / semester-style (limits as stored period) ———
  const semiCore = (share: number) => applyTierUplift(baseExpense * share * 2, 'Core', profile);
  const semiSup = (share: number) => applyTierUplift(baseExpense * share * 2, 'Supporting', profile);
  result.push({
    category: 'Housing Rent',
    limit: applyTierUplift(baseExpense * 0.3 * 12, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Housing Rent'],
  });
  result.push({
    category: 'School Tuition (Semester)',
    limit: semiCore(0.1),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['School Tuition (Semester)'],
  });
  result.push({
    category: 'Bulk Household Maintenance',
    limit: semiSup(0.03),
    period: 'yearly',
    tier: 'Supporting',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Bulk Household Maintenance'],
  });

  // ——— Yearly (sinking fund: save a bit each month) ———
  result.push({
    category: 'Iqama Renewal',
    limit: applyTierUplift(income * 0.02, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Iqama Renewal'],
  });
  result.push({
    category: 'Dependent Fees',
    limit: applyTierUplift((adults + kids) * 4800, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Dependent Fees'],
  });
  result.push({
    category: 'Exit/Re-entry Visa',
    limit: applyTierUplift(income * 0.01, 'Supporting', profile),
    period: 'yearly',
    tier: 'Supporting',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Exit/Re-entry Visa'],
  });
  result.push({
    category: 'Vehicle Insurance',
    limit: applyTierUplift(income * 0.03, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Vehicle Insurance'],
  });
  result.push({
    category: 'Istimara (Registration)',
    limit: applyTierUplift(income * 0.01, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Istimara (Registration)'],
  });
  result.push({
    category: 'Fahas (MVPI)',
    limit: applyTierUplift(income * 0.005, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Fahas (MVPI)'],
  });
  if (kids > 0) {
    result.push({
      category: 'School Uniforms & Books',
      limit: applyTierUplift(kids * 2100, 'Core', profile),
      period: 'yearly',
      tier: 'Core',
      hint: KSA_EXPENSE_CATEGORY_HINTS['School Uniforms & Books'],
    });
  }
  result.push({
    category: 'Zakat',
    limit: applyTierUplift(income * 0.025, 'Core', profile),
    period: 'yearly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Zakat'],
  });
  result.push({
    category: 'Annual Vacation',
    limit: applyTierUplift(income * 0.08, 'Optional', profile),
    period: 'yearly',
    tier: 'Optional',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Annual Vacation'],
  });

  // ——— Weekly ——— (aligned with grocery bump + profile)
  result.push({
    category: 'Fresh Produce (Weekly)',
    limit: Math.round(
      tierAdjustedAmount(baseExpense * 0.03 * 1.1 * groceryProfileSpendingMultiplier(profile), 'Core', profile) / 4.33
    ),
    period: 'weekly',
    tier: 'Core',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Fresh Produce (Weekly)'],
  });
  result.push({
    category: 'Household Help (Hourly)',
    limit: Math.round(tierAdjustedAmount(baseExpense * 0.02, 'Supporting', profile) / 4.33),
    period: 'weekly',
    tier: 'Supporting',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Household Help (Hourly)'],
  });
  result.push({
    category: 'Leisure (Weekly)',
    limit: Math.round(tierAdjustedAmount(baseExpense * 0.02, 'Optional', profile) / 4.33),
    period: 'weekly',
    tier: 'Optional',
    hint: KSA_EXPENSE_CATEGORY_HINTS['Leisure (Weekly)'],
  });

  return result;
}

/** Monthly SAR equivalent for comparing weekly/yearly budget limits. */
export function monthlyEquivalentFromBudgetLimit(
  limit: number,
  period: HouseholdBudgetCategorySuggestion['period']
): number {
  const n = Number(limit) || 0;
  const p = period ?? 'monthly';
  if (p === 'monthly') return n;
  if (p === 'yearly') return n / 12;
  if (p === 'weekly') return n * (52 / 12);
  if (p === 'daily') return n * (365 / 12);
  return n;
}

/** Inverse of monthlyEquivalentFromBudgetLimit (rounded). */
export function budgetLimitFromMonthlyEquivalent(
  monthly: number,
  period: HouseholdBudgetCategorySuggestion['period']
): number {
  const m = Math.max(0, Number(monthly) || 0);
  const p = period ?? 'monthly';
  if (p === 'monthly') return Math.round(m);
  if (p === 'yearly') return Math.round(m * 12);
  if (p === 'weekly') return Math.round(m / (52 / 12));
  if (p === 'daily') return Math.round(m / (365 / 12));
  return Math.round(m);
}

/**
 * Share of monthly salary used as the “spending envelope” when splitting across a subset of categories.
 * Conservative = tighter envelope (more implied savings); Aggressive = wider envelope.
 * Values include +5% uplift (ENVELOPE_BASE_BUMP) vs the legacy engine.
 */
const PROFILE_BULK_ENVELOPE_PCT: Partial<Record<string, number>> = {
  Conservative: 0.52 * ENVELOPE_BASE_BUMP,
  Moderate: 0.58 * ENVELOPE_BASE_BUMP,
  Aggressive: 0.64 * ENVELOPE_BASE_BUMP,
  /** Tighter discretionary envelope than Aggressive; pairs with higher goal/investing weights in the engine. */
  Growth: 0.58 * ENVELOPE_BASE_BUMP,
};

/**
 * When **all** categories are selected, returns the base suggestions unchanged (engine-merged template).
 * When **fewer** are selected, reallocates `salary × envelope(profile)` across **selected** rows only; **unselected**
 * rows get `limit: 0` so bulk-add UI never shows full template amounts next to unchecked boxes.
 * When **no** categories are selected, every row has `limit: 0` (nothing will be created until user selects rows).
 */
export function computeBulkAddLimitsForSelection(
  baseSuggestions: HouseholdBudgetCategorySuggestion[],
  selectedCategoryNames: string[],
  monthlySalary: number,
  profile: HouseholdEngineProfile,
  adults: number = 2,
  kids: number = 0
): HouseholdBudgetCategorySuggestion[] {
  if (!baseSuggestions.length) return [];
  const salary = Number(monthlySalary) || 0;
  if (salary <= 0) return baseSuggestions.map((c) => ({ ...c }));

  const templateCategorySet = new Set(baseSuggestions.map((c) => c.category));
  /** Ignore stale names so “all current categories selected” still counts as full template (no bogus subset reallocation). */
  const selected = new Set(selectedCategoryNames.filter((n) => n && templateCategorySet.has(n)));
  const allSelected =
    baseSuggestions.length > 0 && baseSuggestions.every((c) => selected.has(c.category));
  if (allSelected) return baseSuggestions.map((c) => ({ ...c }));

  if (selected.size === 0) {
    return baseSuggestions.map((c) => ({ ...c, limit: 0 }));
  }

  const selectedRows = baseSuggestions.filter((c) => selected.has(c.category));

  const basePct = PROFILE_BULK_ENVELOPE_PCT[String(profile)] ?? PROFILE_BULK_ENVELOPE_PCT.Moderate ?? 0.58 * ENVELOPE_BASE_BUMP;
  const headScale = householdConsumptionScale(adults, kids);
  const envelopePct = Math.min(0.74, basePct * Math.min(1.14, headScale / 1.02));
  const envelope = salary * envelopePct;

  const weights = selectedRows.map((c) => monthlyEquivalentFromBudgetLimit(c.limit, c.period));
  const sumW = weights.reduce((a, b) => a + b, 0);

  const allocatedMonthly: number[] =
    sumW > 0
      ? weights.map((w) => (envelope * w) / sumW)
      : selectedRows.map(() => envelope / selectedRows.length);

  const limitByCategory = new Map<string, number>();
  selectedRows.forEach((c, i) => {
    limitByCategory.set(c.category, budgetLimitFromMonthlyEquivalent(allocatedMonthly[i], c.period));
  });

  return baseSuggestions.map((c) => {
    if (!selected.has(c.category)) return { ...c, limit: 0 };
    const next = limitByCategory.get(c.category);
    return next != null ? { ...c, limit: next } : { ...c };
  });
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
    config: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG, profile: options?.profile, ...options?.config },
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
      if (countsAsIncomeForCashflowKpi(t)) monthlyActualIncome[m] += amount;
      else if (countsAsExpenseForCashflowKpi(t)) monthlyActualExpense[m] += amount;
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
    config: { ...DEFAULT_HOUSEHOLD_ENGINE_CONFIG, profile: options?.profile, ...options?.config },
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
    } else if (profile === 'Aggressive') {
      return {
        emergencySavings: 0.05,
        reserveSavings: 0.03,
        goalSavings: 0.08,
        retirementSavings: 0.18,
        investing: 0.12,
        kidsFutureSavings: 0.05,
      };
    } else if (profile === 'Growth') {
      return {
        emergencySavings: 0.06,
        reserveSavings: 0.04,
        goalSavings: 0.12,
        retirementSavings: 0.22,
        investing: 0.18,
        kidsFutureSavings: 0.05,
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
    const engineProfile = profile as HouseholdEngineProfile;
    const modeledBase = effectiveTemplateBaseExpense(income, adults, kids);
    const baseExpense = expense > 0 ? expense : modeledBase;

    const groceryShare = groceryShareOfBaseExpense(adults, kids, engineProfile);
    const allocations: Record<string, number> = {
      housing: tierAdjustedAmount(baseExpense * 0.3, 'Core', engineProfile),
      groceries: tierAdjustedAmount(baseExpense * groceryShare, 'Core', engineProfile),
      utilities: tierAdjustedAmount(baseExpense * 0.08, 'Core', engineProfile),
      telecommunications: tierAdjustedAmount(baseExpense * 0.04, 'Core', engineProfile),
      transportation: tierAdjustedAmount(baseExpense * 0.1, 'Core', engineProfile),
      domesticHelp: tierAdjustedAmount(baseExpense * 0.08, 'Supporting', engineProfile),
      diningEntertainment: tierAdjustedAmount(baseExpense * 0.06, 'Optional', engineProfile),
      insuranceCoPay: tierAdjustedAmount(baseExpense * 0.02, 'Core', engineProfile),
      debtLoans: tierAdjustedAmount(baseExpense * 0.05, 'Core', engineProfile),
      remittances: tierAdjustedAmount(baseExpense * 0.08, 'Supporting', engineProfile),
      pocketMoney: tierAdjustedAmount(baseExpense * 0.02, 'Optional', engineProfile),
      food: tierAdjustedAmount(baseExpense * groceryShare, 'Core', engineProfile),
      health: tierAdjustedAmount(baseExpense * 0.02, 'Core', engineProfile),
      personalCare: tierAdjustedAmount(baseExpense * 0.03, 'Supporting', engineProfile),
      entertainment: tierAdjustedAmount(baseExpense * 0.06, 'Optional', engineProfile),
      shopping: tierAdjustedAmount(baseExpense * 0.03, 'Optional', engineProfile),
      miscellaneous: tierAdjustedAmount(baseExpense * 0.02, 'Optional', engineProfile),
    };

    const semiAnnualExpenses = {
      schoolTuition: tierAdjustedAmount(baseExpense * 0.1, 'Core', engineProfile) / 6,
      householdMaintenance: tierAdjustedAmount(baseExpense * 0.03, 'Supporting', engineProfile) / 6,
    };
    Object.assign(allocations, semiAnnualExpenses);

    const heads = Math.max(1, adults + kids);
    const annualExpenses = {
      iqamaRenewal: tierAdjustedAmount(income * 0.02, 'Core', engineProfile) / 12,
      dependentFees: tierAdjustedAmount(heads * 4800, 'Core', engineProfile) / 12,
      exitReentryVisa: tierAdjustedAmount(income * 0.01, 'Supporting', engineProfile) / 12,
      vehicleInsurance: tierAdjustedAmount(income * 0.03, 'Core', engineProfile) / 12,
      istimara: tierAdjustedAmount(income * 0.01, 'Core', engineProfile) / 12,
      fahas: tierAdjustedAmount(income * 0.005, 'Core', engineProfile) / 12,
      schoolUniformsBooks: (kids > 0 ? tierAdjustedAmount(kids * 2100, 'Core', engineProfile) : 0) / 12,
      zakat: tierAdjustedAmount(income * 0.025, 'Core', engineProfile) / 12,
      annualVacation: tierAdjustedAmount(income * 0.08, 'Optional', engineProfile) / 12,
    };
    Object.assign(allocations, annualExpenses);

    const weeklyExpenses = {
      freshProduce:
        tierAdjustedAmount(baseExpense * 0.03 * 1.1 * groceryProfileSpendingMultiplier(engineProfile), 'Core', engineProfile) *
        4.33,
      householdHelpHourly: tierAdjustedAmount(baseExpense * 0.02, 'Supporting', engineProfile) * 4.33,
      leisureWeekly: tierAdjustedAmount(baseExpense * 0.02, 'Optional', engineProfile) * 4.33,
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

    const savingsBucketKeys = new Set([
      'emergencySavings',
      'reserveSavings',
      'goalSavings',
      'retirementSavings',
      'investing',
      'kidsFutureSavings',
    ]);
    const savingsTotal = Array.from(savingsBucketKeys).reduce((s, k) => s + (Number((buckets as Record<string, number>)[k]) || 0), 0);
    const consumptionFromBuckets = Object.entries(buckets).reduce((sum, [k, v]) => {
      if (savingsBucketKeys.has(k)) return sum;
      return sum + (Number(v) || 0);
    }, 0);
    const txExpense = Number(monthlyActualExpense[i] ?? exp);
    const consumptionOutflow = txExpense > 0 ? txExpense : consumptionFromBuckets;

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
      totalPlannedOutflow: consumptionOutflow + savingsTotal,
      totalActualOutflow: consumptionOutflow,
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
