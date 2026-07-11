import type { Holding, InvestmentPortfolio, TradeCurrency } from '../types';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { isTadawulQuoteSymbol } from './marketQuoteRouting';
import { symbolForLiveQuoteFetch } from './tadawulQuoteSanity';

type HoldingLike = Partial<Pick<Holding, 'symbol' | 'holdingType'>> & { holding_type?: string };

export type QuoteRefreshSymbolOpts = {
  /** SAR portfolios: bare letter tickers (e.g. REITF) route to SAHMK as CODE.SR */
  bookCurrency?: TradeCurrency;
};

/**
 * Refresh only quoted holdings (not manual_fund).
 * Manual-valued holdings keep their stored currentValue and should never consume quote API quota.
 */
export function holdingCanUseQuoteRefresh(holding: HoldingLike, opts?: QuoteRefreshSymbolOpts): boolean {
  if (!holdingUsesLiveQuote(holding)) return false;
  return isRefreshableHoldingQuoteSymbol(holding.symbol, opts);
}

/**
 * Whether this holding symbol can receive live quotes (Tadawul: bare code, `.SR`, `.SA`, `.SE`, `TADAWUL:`).
 */
export function isRefreshableHoldingQuoteSymbol(
  symbol: string | null | undefined,
  opts?: QuoteRefreshSymbolOpts,
): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (isTadawulQuoteSymbol(upper)) return true;
  if (opts?.bookCurrency === 'SAR' && /^[A-Z]{3,6}$/.test(upper) && !upper.includes('.')) {
    return true;
  }
  return /^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$/.test(upper);
}

/** Canonical symbol sent to live providers (Tadawul aliases → `CODE.SR`). */
export function refreshableQuoteFetchSymbol(symbol: string, opts?: QuoteRefreshSymbolOpts): string {
  const s = String(symbol ?? '').trim();
  if (!s) return s;
  const upper = s.toUpperCase();
  if (isTadawulQuoteSymbol(s)) return symbolForLiveQuoteFetch(s);
  if (opts?.bookCurrency === 'SAR' && /^[A-Z]{3,6}$/.test(upper) && !upper.includes('.')) {
    return `${upper}.SR`;
  }
  return s;
}

export function getRefreshableHoldingQuoteSymbols(
  holdings: HoldingLike[],
  opts?: QuoteRefreshSymbolOpts,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of holdings) {
    if (!holdingCanUseQuoteRefresh(h, opts)) continue;
    const raw = h.symbol;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const fetchSym = refreshableQuoteFetchSymbol(raw, opts);
    const key = fetchSym.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fetchSym);
  }
  return out;
}

/** Collect refresh symbols across portfolios (respects each portfolio's book currency for Saudi letter tickers). */
export function getRefreshableHoldingQuoteSymbolsFromPortfolios(portfolios: InvestmentPortfolio[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of portfolios) {
    const book = resolveInvestmentPortfolioCurrency(p);
    for (const sym of getRefreshableHoldingQuoteSymbols(p.holdings ?? [], { bookCurrency: book })) {
      const key = sym.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sym);
    }
  }
  return out;
}

/** True when a portfolio has at least one holding that uses live quotes (not manual_fund). */
export function portfolioHasRefreshableQuoteSymbols(portfolio: Pick<InvestmentPortfolio, 'holdings' | 'currency'>): boolean {
  const book = resolveInvestmentPortfolioCurrency(portfolio as InvestmentPortfolio);
  return getRefreshableHoldingQuoteSymbols(portfolio.holdings ?? [], { bookCurrency: book }).length > 0;
}
