/**
 * Shared budget period / category helpers — re-exported from utils so services
 * and utils can share one implementation without circular imports.
 */
export {
  buildNormalizedSpendLookup,
  isYearlyPeriodBudget,
  normalizeBudgetCategoryKey,
  normalizeBudgetPeriod,
  spendFromCategoryMap,
  spendFromNormalizedLookup,
} from '../utils/budgetPeriod';
