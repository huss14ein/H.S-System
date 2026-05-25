import type { FinancialData } from '../types';
import {
  computePersonalHeadlineNetWorthSar,
  type PersonalNetWorthOptions,
} from './personalNetWorth';
import { getTradableCashBucketsForAccount } from './investmentCashLedger';

/** Edge digest has no live quote feed — use stored holdings/commodity marks (same as empty `simulatedPrices` in-app). */
export function buildWeeklyDigestNetWorthOptions(data: FinancialData): PersonalNetWorthOptions {
  const accounts = data.accounts ?? [];
  return {
    getAvailableCashForAccount: (accountId: string) =>
      getTradableCashBucketsForAccount(accountId, accounts),
    simulatedPrices: {},
  };
}

/**
 * **My** personal net worth in SAR for the weekly email — same path as the app headline:
 * `computePersonalHeadlineNetWorthSar` with platform cash from each Accounts balance.
 */
export function computeWeeklyDigestPersonalNetWorthSar(
  data: FinancialData,
  envFallbackSarPerUsd: number,
): number {
  return computePersonalHeadlineNetWorthSar(
    data,
    envFallbackSarPerUsd,
    buildWeeklyDigestNetWorthOptions(data),
  ).netWorth;
}
