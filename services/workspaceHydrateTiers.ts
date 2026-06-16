/** Keys aligned with `fetchPromises` order in DataContext.fetchData. */
export const HYDRATE_FETCH_KEYS = [
  'accounts',
  'assets',
  'liabilities',
  'goals',
  'transactions',
  'investments',
  'investmentTransactions',
  'budgets',
  'watchlist',
  'settings',
  'zakatPayments',
  'priceAlerts',
  'commodityHoldings',
  'plannedTrades',
  'investmentPlan',
  'portfolioUniverse',
  'statusChangeLog',
  'executionLogs',
  'recurringTransactions',
  'budgetRequests',
  'sukukPayoutSchedules',
  'sukukPayoutEvents',
] as const;

export type HydrateFetchKey = (typeof HYDRATE_FETCH_KEYS)[number];

/** Shell + KPI tables — unlock UI without waiting on transactions. */
export const FAST_HYDRATE_INDICES: readonly number[] = [0, 3, 5, 7, 8, 9];

/** Balance-sheet + ledger tables — merged in background after fast tier. */
export const HEAVY_HYDRATE_INDICES: readonly number[] = [1, 2, 4, 6];

export const HYDRATE_SECONDARY_START_INDEX = 10;
