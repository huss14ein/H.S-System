import type { QuotesPriceSource } from '../context/MarketDataContext';

/** User-facing label for header / Investments status (single source of truth). */
export function quoteSourceDisplayLabel(source: QuotesPriceSource): string {
  if (source === 'live') return 'Live';
  if (source === 'cached') return 'Cached';
  return 'Simulated';
}

/** True only after a successful live API fetch this session — not cache restore. */
export function isQuotesFromLiveApi(source: QuotesPriceSource): boolean {
  return source === 'live';
}

/** Show refresh nudges when quotes are not from a live pull. */
export function shouldPromptForLiveQuoteRefresh(source: QuotesPriceSource): boolean {
  return source !== 'live';
}

/**
 * After a quote tick: upgrade to live on network fetch; never downgrade live → cached on cache-only ticks.
 */
export function nextQuotesPriceSourceAfterTick(
  prev: QuotesPriceSource,
  networkFetchedThisTick: boolean,
  hasTrustedQuotes: boolean,
): QuotesPriceSource {
  if (networkFetchedThisTick) return 'live';
  if (prev === 'live') return 'live';
  if (hasTrustedQuotes && prev === 'none') return 'cached';
  return prev;
}

/** Cache rehydrate must not demote an established live session. */
export function quotesPriceSourceAfterCacheRehydrate(prev: QuotesPriceSource): QuotesPriceSource {
  return prev === 'live' ? 'live' : 'cached';
}
