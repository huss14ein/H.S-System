import type { FinancialData, Account } from '../types';
import type { SimulatedPriceMap } from './investmentPlatformCardMetrics';
import { computePortfolioPeriodPnLSummary } from './portfolioPeriodPnL';
import { getPersonalAccounts, getPersonalInvestments } from '../utils/wealthScope';
import { resolveMonthStartDayFromData } from '../utils/financialMonth';
import { brokerCashBucketsFromInvestmentAccount } from './investmentCashLedger';

/** Slim bundle for Edge weekly digest — no React. Uses stored marks + account cash balances. */
export function computeWeeklyDigestPortfolioPnLSar(args: {
  data: FinancialData;
  sarPerUsd: number;
  simulatedPrices?: SimulatedPriceMap;
}): { weeklyTotalSar: number; monthlyTotalSar: number } {
  const portfolios = getPersonalInvestments(args.data);
  const accounts = getPersonalAccounts(args.data);
  if (!portfolios.length) return { weeklyTotalSar: 0, monthlyTotalSar: 0 };
  /** Match Investments hub cash when DataContext getter is unavailable (Edge digest). */
  const getAvailableCashForAccount = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    return brokerCashBucketsFromInvestmentAccount(acc);
  };
  const summary = computePortfolioPeriodPnLSummary({
    data: args.data,
    portfolios,
    accounts: accounts as Account[],
    sarPerUsd: args.sarPerUsd,
    simulatedPrices: args.simulatedPrices ?? {},
    monthStartDay: resolveMonthStartDayFromData(args.data),
    getAvailableCashForAccount,
  });
  return {
    weeklyTotalSar: summary.weeklyTotalSar,
    monthlyTotalSar: summary.monthlyTotalSar,
  };
}
