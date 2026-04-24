import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { toSAR, resolveSarPerUsd } from './currencyMath';
import { inferInvestmentTransactionCurrency } from './investmentLedgerCurrency';
import { getInvestmentTransactionCashAmount } from './investmentTransactionCash';
import { getSarPerUsdForCalendarDay, hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';

/**
 * Convert an investment transaction cash amount to SAR using a dated FX rate (per calendar day)
 * when the transaction currency is USD. Falls back to the resolved spot rate when day is missing.
 *
 * NOTE: Amounts are derived from `total` for non-buy/sell types; dividends MUST have `total > 0`.
 */
export function investmentTransactionCashAmountSarDated(args: {
  tx: InvestmentTransaction;
  accounts: Account[];
  portfolios: InvestmentPortfolio[];
  data: FinancialData | null | undefined;
  uiExchangeRate: number;
}): number {
  const { tx, accounts, portfolios, data, uiExchangeRate } = args;
  const amount = getInvestmentTransactionCashAmount(tx as any);
  if (!(amount > 0)) return 0;

  const currency = inferInvestmentTransactionCurrency(tx as any, accounts, portfolios);
  if (currency === 'SAR') return amount;

  const day = String(tx.date ?? '').slice(0, 10);
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  if (data) hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  const r = day.length === 10 ? getSarPerUsdForCalendarDay(day, data, uiExchangeRate) : spot;
  return toSAR(amount, 'USD', r);
}

