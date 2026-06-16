import type { FinancialData } from '../types';
import { getStaleQuoteSymbols } from './dataQuality/marketDataStale';
import { getRefreshableHoldingQuoteSymbols } from './quoteRefreshSymbols';

export function getTrackedQuoteSymbolsFromData(data: FinancialData | null | undefined): string[] {
  if (!data) return [];
  const holdings = (data.investments ?? []).flatMap((p) => p.holdings ?? []);
  return getRefreshableHoldingQuoteSymbols(holdings);
}

export function quoteRefreshFingerprint(
  symbols: string[],
  symbolQuoteUpdatedAt: Record<string, string | undefined>,
): string {
  return symbols
    .map((s) => String(s ?? '').trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .map((s) => `${s}:${symbolQuoteUpdatedAt[s] ?? ''}`)
    .join('|');
}

export function canAutoCaptureNetWorthSnapshot(input: {
  showHydrateBanner: boolean;
  isRefreshing: boolean;
  hasQueuedPriceRefresh: () => boolean;
  symbolQuoteUpdatedAt: Record<string, string | undefined>;
  isLive: boolean;
  data: FinancialData | null | undefined;
  /** Phase-2 canonical metrics merged (live investment ROI + wealth summary path). */
  metricsExtendedReady?: boolean;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
}): boolean {
  if (input.showHydrateBanner || !input.data) return false;
  if (!input.getAvailableCashForAccount) return false;
  if (input.metricsExtendedReady === false) return false;
  if (input.isRefreshing || input.hasQueuedPriceRefresh()) return false;

  const tracked = getTrackedQuoteSymbolsFromData(input.data);
  if (tracked.length === 0) return true;

  const stale = getStaleQuoteSymbols(tracked, input.symbolQuoteUpdatedAt, input.isLive, {
    countMissingTimestampAsStale: true,
  });
  return stale.length === 0;
}
