import type { FinancialData } from '../types';
import {
  computePersonalHeadlineNetWorthSar,
  type PersonalNetWorthOptions,
} from './personalNetWorth';
import { getTradableCashBucketsForAccount } from './investmentCashLedger';
import { computeHeadlinePersonalInvestmentRoiDecimal } from './investmentKpiCore';
import { presentHeadlineInvestmentGrowth, type HeadlineInvestmentGrowthPresentation } from './extendedMetricsPresentation';

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

/**
 * Headline investment growth for the weekly email — same math as the app, stored marks only
 * (no live quote fetch). Net invested is deposits − withdrawals when funding history exists.
 */
export function computeWeeklyDigestInvestmentGrowth(
  data: FinancialData,
  envFallbackSarPerUsd: number,
): HeadlineInvestmentGrowthPresentation | null {
  const opts = buildWeeklyDigestNetWorthOptions(data);
  const nw = computePersonalHeadlineNetWorthSar(data, envFallbackSarPerUsd, opts);
  const getCash = opts.getAvailableCashForAccount;
  if (!getCash) return null;
  const exposure = computeHeadlinePersonalInvestmentRoiDecimal(
    data,
    nw.sarPerUsd,
    getCash,
    opts.simulatedPrices ?? {},
  );
  return presentHeadlineInvestmentGrowth(exposure);
}
