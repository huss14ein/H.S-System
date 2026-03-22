import type { Holding, TradeCurrency } from '../types';

/**
 * When `investment_portfolios.currency` is missing (legacy rows), infer the book currency from symbols:
 * any Tadawul listing (*.SR / *.SA) ⇒ values are in SAR; otherwise assume USD (typical US listings).
 */
export function resolvePortfolioCurrencyFromHoldings(holdings: Array<{ symbol?: string }>): TradeCurrency {
  const syms = holdings.map((h) => String(h.symbol ?? '').toUpperCase());
  if (syms.some((s) => /\.(SR|SA)$/.test(s))) return 'SAR';
  return 'USD';
}

/** Resolved portfolio book currency for display and P/L math (never leave null → wrong USD label). */
export function resolveInvestmentPortfolioCurrency(portfolio: {
  currency?: TradeCurrency;
  holdings?: Holding[];
}): TradeCurrency {
  const c = portfolio.currency;
  if (c === 'SAR' || c === 'USD') return c;
  return resolvePortfolioCurrencyFromHoldings(portfolio.holdings ?? []);
}
