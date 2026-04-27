import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { computeAvailableCashByAccountMap } from './investmentCashLedger';
import { computePersonalNetWorthBreakdownSAR } from './personalNetWorth';

/**
 * **My** personal net worth in SAR for the weekly email — same path as the app headline:
 * `resolveSarPerUsd` (incl. `wealthUltraConfig.fxRate` from `data`) + `computePersonalNetWorthBreakdownSAR`
 * with deployable cash on investment accounts from the investment transaction ledger.
 */
export function computeWeeklyDigestPersonalNetWorthSar(
  data: FinancialData,
  envFallbackSarPerUsd: number,
): number {
  const sarPerUsd = resolveSarPerUsd(data, envFallbackSarPerUsd);
  const cashMap = computeAvailableCashByAccountMap({
    accounts: data.accounts ?? [],
    investments: data.investments ?? [],
    investmentTransactions: data.investmentTransactions ?? [],
    sarPerUsd,
  });
  const getAvailableCashForAccount = (accountId: string) => cashMap[accountId] ?? { SAR: 0, USD: 0 };
  return computePersonalNetWorthBreakdownSAR(data, sarPerUsd, { getAvailableCashForAccount }).netWorth;
}
