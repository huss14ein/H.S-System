import type { Holding } from '../types';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';

type HoldingLike = Partial<Pick<Holding, 'symbol' | 'holdingType'>> & { holding_type?: string };

/**
 * Refresh only quoted ticker holdings.
 * Manual-valued holdings keep their stored currentValue and should never consume quote API quota.
 */
export function holdingCanUseQuoteRefresh(holding: HoldingLike): boolean {
  if (!holdingUsesLiveQuote(holding)) return false;
  return isRefreshableHoldingQuoteSymbol(holding.symbol);
}

/**
 * Tadawul holdings must be entered as `.SR` to participate in live quote refreshes.
 * This prevents slow/duplicated API lookups for `.SA`, `.SC`, bare Tadawul codes, or provider aliases.
 */
export function isRefreshableHoldingQuoteSymbol(symbol: string | null | undefined): boolean {
  const upper = String(symbol ?? '').trim().toUpperCase();
  if (!upper) return false;

  if (/^TADAWUL:[A-Z0-9]{1,8}$/.test(upper)) return false;
  if (/^[0-9]{4,6}$/.test(upper)) return false;

  const tadawulSuffix = upper.match(/^[A-Z0-9]{1,8}\.(S[A-Z0-9]*)$/);
  if (tadawulSuffix) return tadawulSuffix[1] === 'SR';

  return true;
}

export function getRefreshableHoldingQuoteSymbols(holdings: HoldingLike[]): string[] {
  return holdings
    .filter(holdingCanUseQuoteRefresh)
    .map((h) => h.symbol)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}
