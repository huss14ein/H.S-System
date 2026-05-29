import { useMemo } from 'react';
import type { FinancialData } from '../types';
import {
  getPersonalAccounts,
  getPersonalInvestments,
  getPersonalTransactions,
} from '../utils/wealthScope';

/** Personal-scope rows for Dashboard/Summary suite modules (matches Investments hub / KPI scope). */
export function useDashboardSuiteScope(data: FinancialData | null | undefined) {
  return useMemo(
    () => ({
      personalTransactions: getPersonalTransactions(data),
      personalAccounts: getPersonalAccounts(data),
      personalInvestments: getPersonalInvestments(data),
    }),
    [data],
  );
}
