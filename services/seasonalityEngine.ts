/**
 * Annualization + seasonality logic (logic layer).
 *
 * Goal: preserve real month spikes while still providing reasonable monthly
 * provisioning and "pressure" flags for event-heavy months.
 */

export interface SeasonalityEvent {
  /**
   * Months where the event happens.
   * 1-12 for Jan-Dec.
   */
  months: number[];
  /** Extra multiplier applied to the base monthly expense during event months. */
  expenseMultiplier: number;
  /** Optional label used by UI/reports. */
  label?: string;
}

export interface AnnualCostEvent {
  /** Total known annual (or one-off) cost to provision. */
  annualAmount: number;
  /** When the cost is actually due (month 1-12). */
  dueMonth: number;
  /** Optional smoothing window: how many months before dueMonth to distribute. */
  provisionMonths?: number;
}

function clampMonth(m: number): number {
  if (!Number.isFinite(m)) return 1;
  const x = Math.floor(m);
  return Math.min(12, Math.max(1, x));
}

/**
 * Apply seasonality multipliers to a base monthly expense.
 * If no event matches the month, the base expense is returned unchanged.
 */
export function seasonalityAdjustedExpense(args: {
  baseMonthlyExpense: number;
  month: number; // 1-12
  events?: SeasonalityEvent[];
}): number {
  const base = Number.isFinite(args.baseMonthlyExpense) ? args.baseMonthlyExpense : 0;
  const month = clampMonth(args.month);
  const events = args.events ?? [];
  const multipliers = events
    .filter((e) => (e.months ?? []).some((m) => clampMonth(m) === month))
    .map((e) => (Number.isFinite(e.expenseMultiplier) ? e.expenseMultiplier : 1));

  // Multipliers compose multiplicatively.
  return multipliers.reduce((acc, m) => acc * (m > 0 ? m : 1), base);
}

/**
 * Convert a known annual expense into a monthly provision amount.
 * If you specify `provisionMonths`, the provisioning is spread across that
 * many months ending at the due month (inclusive).
 */
export function annualExpenseMonthlyProvision(args: {
  annualAmount: number;
  dueMonth: number; // 1-12
  /** How many months before dueMonth to spread this cost. Default: 12 (full-year). */
  provisionMonths?: number;
}): number {
  const annualAmount = Math.max(0, Number(args.annualAmount) || 0);
  const provisionMonths = args.provisionMonths ?? 12;
  const pm = Math.max(1, Math.floor(provisionMonths));
  return annualAmount / pm;
}

/**
 * For a specific month, check if adjusted expense pressure exceeds a threshold.
 * Useful for flagging months like tuition/rent/bonus/annual insurance.
 */
export function eventMonthStressCheck(args: {
  adjustedMonthlyExpense: number;
  /** External threshold: what counts as "high pressure" relative to typical spend. */
  baselineMonthlyExpense: number;
  /** Default: 1.25x baseline. */
  thresholdMultiplier?: number;
}): { isStressMonth: boolean; threshold: number } {
  const baseline = Number.isFinite(args.baselineMonthlyExpense) ? args.baselineMonthlyExpense : 0;
  const adjusted = Number.isFinite(args.adjustedMonthlyExpense) ? args.adjustedMonthlyExpense : 0;
  const thresholdMultiplier = args.thresholdMultiplier ?? 1.25;
  const threshold = baseline * thresholdMultiplier;
  return { isStressMonth: adjusted > threshold, threshold };
}

/**
 * Optional helper: common event types that the app can map to.
 * This does not enforce any jurisdictional logic; it’s just sensible defaults.
 */
export function buildDefaultSeasonalityEvents(): SeasonalityEvent[] {
  return [
    // Bonus month(s): default to June/December as examples.
    { months: [6, 12], expenseMultiplier: 1.15, label: 'Bonus season' },
    // Tuition / school fees: default to August/September.
    { months: [8, 9], expenseMultiplier: 1.25, label: 'Tuition season' },
    // Annual insurance renewal / maintenance: default to January.
    { months: [1], expenseMultiplier: 1.2, label: 'Annual renewals' },
    // Ramadan/Eid: variable, so defaults to an example month (March).
    { months: [3], expenseMultiplier: 1.1, label: 'Ramadan/Eid season (example)' },
  ];
}

