import type { Holding, InvestmentPortfolio } from '../types';
import { portfolioHasRefreshableQuoteSymbols } from './quoteRefreshSymbols';
import { resolveInvestmentHawlStart, evaluateHawlEligibility } from './zakatHawl';
import type { InvestmentTransaction } from '../types';

export type ZakatHoldingBadgeState = 'in_hawl' | 'zakatable' | 'unknown';

export function resolveZakatHoldingBadgeState(args: {
  holding: Holding;
  portfolio: InvestmentPortfolio;
  investmentTransactions?: InvestmentTransaction[];
  asOf?: Date;
}): ZakatHoldingBadgeState {
  const asOf = args.asOf ?? new Date();
  const resolution = resolveInvestmentHawlStart(args.holding, args.portfolio.id, args.investmentTransactions);
  const eligibility = evaluateHawlEligibility(resolution.startDate, asOf, false);
  if (resolution.source === 'none') return 'unknown';
  if (eligibility.eligible) return 'zakatable';
  return 'in_hawl';
}

export function zakatHoldingBadgeLabel(state: ZakatHoldingBadgeState): string {
  switch (state) {
    case 'in_hawl':
      return 'In hawl';
    case 'zakatable':
      return 'Zakatable';
    default:
      return 'Unknown date';
  }
}

export function portfolioQuoteSymbols(portfolio: InvestmentPortfolio): string[] {
  if (!portfolioHasRefreshableQuoteSymbols(portfolio)) return [];
  return (portfolio.holdings ?? [])
    .map((h) => String(h.symbol ?? '').trim().toUpperCase())
    .filter(Boolean);
}

export type QuoteHealthState = 'fresh' | 'stale' | 'missing';

const STALE_MS = 24 * 60 * 60 * 1000;

export function resolvePortfolioQuoteHealth(args: {
  portfolio: InvestmentPortfolio;
  symbolQuoteUpdatedAt: Record<string, string | undefined>;
  nowMs?: number;
}): QuoteHealthState {
  const symbols = portfolioQuoteSymbols(args.portfolio);
  if (symbols.length === 0) return 'missing';
  const now = args.nowMs ?? Date.now();
  let anyFresh = false;
  let anyStamp = false;
  for (const sym of symbols) {
    const stamp = args.symbolQuoteUpdatedAt[sym];
    if (!stamp) continue;
    anyStamp = true;
    const age = now - new Date(stamp).getTime();
    if (Number.isFinite(age) && age <= STALE_MS) anyFresh = true;
  }
  if (!anyStamp) return 'missing';
  return anyFresh ? 'fresh' : 'stale';
}
