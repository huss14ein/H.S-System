/**
 * Hybrid AI/local budget categorization and price benchmarks for categories and recurring bills.
 * Local rules run first; AI can refine or classify ambiguous transactions.
 */

export const BUDGET_CATEGORIES = [
  'Food',
  'Transportation',
  'Housing',
  'Utilities',
  'Shopping',
  'Entertainment',
  'Health',
  'Education',
  'Savings & Investments',
  'Personal Care',
  'Miscellaneous',
] as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** Local keyword → category mapping for fast classification. */
const LOCAL_CATEGORY_KEYWORDS: Record<string, BudgetCategory> = {
  grocery: 'Food',
  groceries: 'Food',
  food: 'Food',
  restaurant: 'Food',
  cafe: 'Food',
  supermarket: 'Food',
  fuel: 'Transportation',
  gas: 'Transportation',
  car: 'Transportation',
  uber: 'Transportation',
  taxi: 'Transportation',
  rent: 'Housing',
  mortgage: 'Housing',
  electricity: 'Utilities',
  water: 'Utilities',
  internet: 'Utilities',
  phone: 'Utilities',
  shopping: 'Shopping',
  amazon: 'Shopping',
  clothing: 'Shopping',
  entertainment: 'Entertainment',
  movie: 'Entertainment',
  gym: 'Health',
  doctor: 'Health',
  pharmacy: 'Health',
  hospital: 'Health',
  school: 'Education',
  course: 'Education',
  savings: 'Savings & Investments',
  investment: 'Savings & Investments',
  personal: 'Personal Care',
  care: 'Personal Care',
};

/** Default monthly price benchmarks per category (e.g. for alerts). */
export const CATEGORY_PRICE_BENCHMARKS: Record<BudgetCategory, { low: number; typical: number; high: number }> = {
  Food: { low: 800, typical: 1500, high: 3000 },
  Transportation: { low: 300, typical: 800, high: 2000 },
  Housing: { low: 2000, typical: 5000, high: 15000 },
  Utilities: { low: 200, typical: 500, high: 1200 },
  Shopping: { low: 200, typical: 600, high: 2000 },
  Entertainment: { low: 100, typical: 400, high: 1200 },
  Health: { low: 100, typical: 300, high: 1000 },
  Education: { low: 0, typical: 500, high: 3000 },
  'Savings & Investments': { low: 500, typical: 2000, high: 10000 },
  'Personal Care': { low: 50, typical: 200, high: 600 },
  Miscellaneous: { low: 50, typical: 200, high: 800 },
};

export interface ClassificationResult {
  category: BudgetCategory;
  confidence: 'high' | 'medium' | 'low';
  source: 'local' | 'ai';
  /** When source is local, matched keyword. */
  matchedKeyword?: string;
}

/**
 * Classify a transaction description (and optional merchant) to a budget category using local rules.
 */
export function classifyCategoryLocal(
  description: string,
  existingCategory?: string
): ClassificationResult {
  const text = `${(description || '').toLowerCase()} ${(existingCategory || '').toLowerCase()}`;
  for (const [keyword, category] of Object.entries(LOCAL_CATEGORY_KEYWORDS)) {
    if (text.includes(keyword)) {
      return {
        category,
        confidence: 'high',
        source: 'local',
        matchedKeyword: keyword,
      };
    }
  }
  if (existingCategory && BUDGET_CATEGORIES.includes(existingCategory as BudgetCategory)) {
    return {
      category: existingCategory as BudgetCategory,
      confidence: 'medium',
      source: 'local',
    };
  }
  return {
    category: 'Miscellaneous',
    confidence: 'low',
    source: 'local',
  };
}

/**
 * Compare monthly spend for a category against benchmarks.
 */
export function getCategoryBenchmark(
  category: BudgetCategory,
  monthlySpend: number
): { band: 'below_low' | 'low' | 'typical' | 'high' | 'above_high'; benchmark: { low: number; typical: number; high: number } } {
  const benchmark = CATEGORY_PRICE_BENCHMARKS[category];
  let band: 'below_low' | 'low' | 'typical' | 'high' | 'above_high' = 'typical';
  if (monthlySpend < benchmark.low) band = monthlySpend < benchmark.low * 0.5 ? 'below_low' : 'low';
  else if (monthlySpend > benchmark.high) band = 'above_high';
  else if (monthlySpend > benchmark.typical) band = 'high';
  return { band, benchmark };
}

/**
 * Recurring bill benchmark (e.g. for "is this bill high?").
 */
export interface RecurringBillBenchmark {
  category: BudgetCategory;
  typicalMonthly: number;
  band: 'below_low' | 'low' | 'typical' | 'high' | 'above_high';
}

export function benchmarkRecurringBill(
  category: BudgetCategory,
  amount: number,
  period: 'monthly' | 'weekly' | 'yearly' = 'monthly'
): RecurringBillBenchmark {
  let monthly = amount;
  if (period === 'weekly') monthly = amount * (52 / 12);
  if (period === 'yearly') monthly = amount / 12;
  const { band } = getCategoryBenchmark(category, monthly);
  const b = CATEGORY_PRICE_BENCHMARKS[category];
  return {
    category,
    typicalMonthly: b.typical,
    band,
  };
}
