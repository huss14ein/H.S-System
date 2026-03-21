import { Holding, InvestmentPortfolio, TradeCurrency } from '../types';

const safeRate = (r: number): number => (Number.isFinite(r) && r > 0 ? r : 3.75);

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

  return toSAR(holdingsValueInPortfolioCurrency, portfolio.currency, exchangeRate);
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
