import { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import { resolveInvestmentPortfolioCurrency } from './investmentPortfolioCurrency';

/** How many SAR equal 1 USD (multiply a USD amount by this to get SAR). */
export const DEFAULT_SAR_PER_USD = 3.75;

const safeRate = (r: number): number => (Number.isFinite(r) && r > 0 ? r : DEFAULT_SAR_PER_USD);
const normalizeSarPegRate = (r: number): number => {
  const safe = safeRate(r);
  // USD/SAR is effectively pegged; normalize near-peg feed jitter/drift to the canonical 3.75
  // so KPI and UI conversions remain stable and deterministic.
  if (safe >= 3.64 && safe <= 3.86) return DEFAULT_SAR_PER_USD;
  return safe;
};

/**
 * `exchangeRate` / `sarPerUsd` throughout the app: **SAR per 1 USD** (same as `toSAR` / `fromSAR`).
 * Prefer `wealthUltraConfig.fxRate` when set so deployable cash matches Wealth Ultra & Investments.
 */
export function resolveSarPerUsd(
  data: { wealthUltraConfig?: { fxRate?: number | null } | null } | null | undefined,
  uiSarPerUsd?: number,
): number {
  const w = Number(data?.wealthUltraConfig?.fxRate);
  if (Number.isFinite(w) && w > 0) {
    // Legacy rows sometimes stored **USD per 1 SAR** (~0.27) instead of SAR per 1 USD (~3.75).
    if (w < 0.55) return normalizeSarPegRate(1 / w);
    return normalizeSarPegRate(w);
  }
  const u = Number(uiSarPerUsd);
  if (Number.isFinite(u) && u > 0) return normalizeSarPegRate(u);
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
 * Terminal value for simple MWRR: all personal portfolio holdings (book → SAR) plus **tradable** cash
 * on investment platforms (ledger), matching how the Investments KPI thinks about total book value.
 */
export function personalInvestmentTerminalValueSAR(args: {
  portfolios: InvestmentPortfolio[];
  investmentAccountIds: string[];
  exchangeRate: number;
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
}): number {
  const { portfolios, investmentAccountIds, exchangeRate, getAvailableCashForAccount } = args;
  const holdingsSar = getAllInvestmentsValueInSAR(portfolios, exchangeRate);
  let cashSar = 0;
  for (const id of investmentAccountIds) {
    cashSar += tradableCashBucketToSAR(getAvailableCashForAccount(id), exchangeRate);
  }
  return holdingsSar + cashSar;
}

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
 * Same FX path as {@link tradableCashBucketToSAR} but does **not** floor SAR/USD at zero.
 * Use for reconciliation when the ledger is inconsistent (spend exceeds balance) so drift is visible.
 */
export const tradableCashBucketToSARSigned = (
  cash: { SAR: number; USD: number },
  exchangeRate: number,
): number => {
  const sar = Number.isFinite(cash.SAR) ? cash.SAR : 0;
  const usd = Number.isFinite(cash.USD) ? cash.USD : 0;
  return sar + toSAR(usd, 'USD', exchangeRate);
};

/**
 * Liquid cash in SAR: Checking + Savings balances, plus **tradable** cash on investment platforms
 * (ledger from `investment_transactions`), not account `balance` and not holdings market value.
 */
export const totalLiquidCashSARFromAccounts = (
  accounts: { id: string; type?: string; balance?: number; currency?: TradeCurrency }[],
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number },
  exchangeRate: number,
): number => {
  let sum = 0;
  for (const a of accounts) {
    const t = a.type ?? '';
    if (t === 'Checking' || t === 'Savings') {
      const bal = Math.max(0, Number(a.balance) || 0);
      const cur = a.currency === 'USD' ? 'USD' : 'SAR';
      sum += toSAR(bal, cur, exchangeRate);
    } else if (t === 'Investment') {
      sum += tradableCashBucketToSAR(getAvailableCashForAccount(a.id), exchangeRate);
    }
  }
  return sum;
};

/** Tadawul-style symbols use SAR; some feeds use numeric `.SE` for the same listings as `.SR`. */
export function inferInstrumentCurrencyFromSymbol(symbol: string): TradeCurrency {
  const s = (symbol || '').trim().toUpperCase();
  if (/(\.SR|\.SA)$/i.test(s)) return 'SAR';
  if (/^[0-9]{4,6}\.SE$/i.test(s)) return 'SAR';
  if (/^[0-9]{4,6}$/.test(s)) return 'SAR';
  if (/^TADAWUL:\s*[0-9]{4,6}$/.test(s)) return 'SAR';
  return 'USD';
}

/**
 * Tradable cash on an investment platform, expressed in the portfolio ledger currency (same rule as `recordTrade` in DataContext).
 */
export function availableTradableCashInLedgerCurrency(
  buckets: { SAR: number; USD: number },
  ledgerCurrency: TradeCurrency,
  sarPerUsd: number,
): number {
  const sar = Number.isFinite(buckets.SAR) ? Math.max(0, buckets.SAR) : 0;
  const usd = Number.isFinite(buckets.USD) ? Math.max(0, buckets.USD) : 0;
  const r = safeRate(sarPerUsd);
  if (ledgerCurrency === 'SAR') return sar + usd * r;
  return usd + sar / r;
}

/** Convert a nominal amount (cash or price) between USD and SAR using the same FX as the rest of the app. */
export function convertBetweenTradeCurrencies(
  amount: number,
  from: TradeCurrency,
  to: TradeCurrency,
  sarPerUsd: number,
): number {
  if (from === to) return amount;
  if (from === 'SAR' && to === 'USD') return fromSAR(amount, 'USD', sarPerUsd);
  if (from === 'USD' && to === 'SAR') return toSAR(amount, 'USD', sarPerUsd);
  return amount;
}

/**
 * Live quote notional (price × quantity): quotes are in **instrument** currency (e.g. USD for AAPL),
 * portfolio rows are in **book** currency (SAR or USD). Converts so KPIs and tables stay consistent.
 */
export function quoteNotionalInBookCurrency(
  pricePerUnit: number,
  quantity: number,
  symbol: string,
  bookCurrency: TradeCurrency,
  sarPerUsd: number,
): number {
  const inst = inferInstrumentCurrencyFromSymbol(symbol);
  const q = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const p = Number.isFinite(pricePerUnit) ? pricePerUnit : 0;
  const raw = p * q;
  if (raw <= 0) return 0;
  return convertBetweenTradeCurrencies(raw, inst, bookCurrency, sarPerUsd);
}

/** Today's move (change per share × qty) from instrument currency into portfolio book currency. */
export function quoteDailyPnLInBookCurrency(
  changePerShare: number,
  quantity: number,
  symbol: string,
  bookCurrency: TradeCurrency,
  sarPerUsd: number,
): number {
  const inst = inferInstrumentCurrencyFromSymbol(symbol);
  const q = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const c = Number.isFinite(changePerShare) ? changePerShare : 0;
  return convertBetweenTradeCurrencies(c * q, inst, bookCurrency, sarPerUsd);
}
