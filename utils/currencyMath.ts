import { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import { resolveInvestmentPortfolioCurrency } from './investmentPortfolioCurrency';

/** How many SAR equal 1 USD (multiply a USD amount by this to get SAR). */
export const DEFAULT_SAR_PER_USD = 3.75;

const safeRate = (r: number): number => (Number.isFinite(r) && r > 0 ? r : DEFAULT_SAR_PER_USD);

/**
 * `exchangeRate` / `sarPerUsd` throughout the app: **SAR per 1 USD** (same as `toSAR` / `fromSAR`).
 * Prefer `wealthUltraConfig.fxRate` when set so deployable cash matches Wealth Ultra & Investments.
 */
export function resolveSarPerUsd(
  data: { wealthUltraConfig?: { fxRate?: number | null } | null } | null | undefined,
  uiSarPerUsd?: number,
): number {
  const w = Number(data?.wealthUltraConfig?.fxRate);
  if (Number.isFinite(w) && w > 0) return w;
  const u = Number(uiSarPerUsd);
  if (Number.isFinite(u) && u > 0) return u;
  return DEFAULT_SAR_PER_USD;
}

export const toSAR = (amount: number, currency: TradeCurrency | undefined, exchangeRate: number): number => {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if ((currency ?? 'USD') === 'USD') return safeAmount * safeRate(exchangeRate);
  return safeAmount;
};

export const fromSAR = (amountSar: number, currency: TradeCurrency | undefined, exchangeRate: number): number => {
  const safeAmount = Number.isFinite(amountSar) ? amountSar : 0;
  if ((currency ?? 'USD') === 'USD') return safeAmount / safeRate(exchangeRate);
  return safeAmount;
};

export const getPortfolioHoldingsValueInSAR = (
  portfolio: InvestmentPortfolio,
  exchangeRate: number,
  getHoldingValue?: (holding: Holding) => number,
): number => {
  const holdingsValueInPortfolioCurrency = (portfolio.holdings || []).reduce((sum, holding) => {
    const value = getHoldingValue ? getHoldingValue(holding) : holding.currentValue;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const bookCurrency = resolveInvestmentPortfolioCurrency(portfolio);
  return toSAR(holdingsValueInPortfolioCurrency, bookCurrency, exchangeRate);
};

export const getAllInvestmentsValueInSAR = (
  portfolios: InvestmentPortfolio[],
  exchangeRate: number,
  getHoldingValue?: (holding: Holding) => number,
): number => {
  return (portfolios || []).reduce(
    (sum, portfolio) => sum + getPortfolioHoldingsValueInSAR(portfolio, exchangeRate, getHoldingValue),
    0,
  );
};

/**
 * Converts a **tradable cash** bucket (from investment transaction ledger) to a single SAR number.
 * USD is converted using the same `toSAR` rule as elsewhere.
 */
export const tradableCashBucketToSAR = (
  cash: { SAR: number; USD: number },
  exchangeRate: number,
): number => {
  const sar = Number.isFinite(cash.SAR) ? Math.max(0, cash.SAR) : 0;
  const usd = Number.isFinite(cash.USD) ? Math.max(0, cash.USD) : 0;
  return sar + toSAR(usd, 'USD', exchangeRate);
};

/**
 * Liquid cash in SAR: Checking + Savings balances, plus **tradable** cash on investment platforms
 * (ledger from `investment_transactions`), not account `balance` and not holdings market value.
 */
export const totalLiquidCashSARFromAccounts = (
  accounts: { id: string; type?: string; balance?: number }[],
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
  exchangeRate: number,
): number => {
  let sum = 0;
  for (const a of accounts) {
    const t = a.type ?? '';
    if (t === 'Checking' || t === 'Savings') {
      sum += Math.max(0, Number(a.balance) || 0);
    } else if (t === 'Investment') {
      sum += tradableCashBucketToSAR(getAvailableCashForAccount(a.id), exchangeRate);
    }
  }
  return sum;
};
