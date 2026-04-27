import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { computeBrokerCashByAccountMap } from './investmentCashLedger';
import { computePersonalNetWorthBreakdownSAR } from './personalNetWorth';

/**
 * **My** personal net worth in SAR for the weekly email — same path as the app headline:
 * `resolveSarPerUsd` (incl. `wealthUltraConfig.fxRate` from `data`) + `computePersonalNetWorthBreakdownSAR`
 * with deployable cash on investment accounts from each platform’s **Accounts balance** (same as `getAvailableCashForAccount`).
 */
export function computeWeeklyDigestPersonalNetWorthSar(
  data: FinancialData,
  envFallbackSarPerUsd: number,
): number {
  const sarPerUsd = resolveSarPerUsd(data, envFallbackSarPerUsd);
  const cashMap = computeBrokerCashByAccountMap(data.accounts ?? []);
  const getAvailableCashForAccount = (accountId: string) => cashMap[accountId] ?? { SAR: 0, USD: 0 };
  return computePersonalNetWorthBreakdownSAR(data, sarPerUsd, { getAvailableCashForAccount }).netWorth;
}
