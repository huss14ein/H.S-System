import type { FinancialData } from '../types';

type DataWithPersonalScope = FinancialData & {
  personalAccounts?: unknown[];
  personalInvestments?: unknown[];
};

/**
 * True once Supabase (or restore) has populated at least one meaningful personal row.
 * Used so background refetches do not block every page behind a full-screen spinner.
 */
export function financialDataHasHydrated(data: FinancialData | null | undefined): boolean {
  if (!data) return false;
  const d = data as DataWithPersonalScope;
  if ((d.personalAccounts ?? data.accounts ?? []).length > 0) return true;
  if ((d.personalInvestments ?? data.investments ?? []).length > 0) return true;
  if ((data.transactions?.length ?? 0) > 0) return true;
  if ((data.goals?.length ?? 0) > 0) return true;
  if ((data.budgets?.length ?? 0) > 0) return true;
  if ((data.liabilities?.length ?? 0) > 0) return true;
  if ((data.assets?.length ?? 0) > 0) return true;
  if ((data.commodityHoldings?.length ?? 0) > 0) return true;
  return false;
}
