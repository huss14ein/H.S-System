import { describe, it, expect } from 'vitest';
import {
  canAutoCaptureNetWorthSnapshot,
  getTrackedQuoteSymbolsFromData,
  quoteRefreshFingerprint,
} from '../services/netWorthSnapshotReadiness';
import type { FinancialData } from '../types';

describe('netWorthSnapshotReadiness', () => {
  const baseData = {
    investments: [{ holdings: [{ symbol: 'AAPL' }] }],
  } as unknown as FinancialData;

  it('blocks capture while hydrate banner is shown', () => {
    expect(
      canAutoCaptureNetWorthSnapshot({
        showHydrateBanner: true,
        isRefreshing: false,
        hasQueuedPriceRefresh: () => false,
        symbolQuoteUpdatedAt: { AAPL: new Date().toISOString() },
        isLive: true,
        data: baseData,
      }),
    ).toBe(false);
  });

  it('blocks capture while quotes are refreshing or queued', () => {
    const readyInput = {
      showHydrateBanner: false,
      isRefreshing: false,
      hasQueuedPriceRefresh: () => false,
      symbolQuoteUpdatedAt: { AAPL: new Date().toISOString() },
      isLive: true,
      data: baseData,
    };
    expect(canAutoCaptureNetWorthSnapshot({ ...readyInput, isRefreshing: true })).toBe(false);
    expect(
      canAutoCaptureNetWorthSnapshot({
        ...readyInput,
        hasQueuedPriceRefresh: () => true,
      }),
    ).toBe(false);
  });

  it('allows capture when no tracked symbols', () => {
    expect(
      canAutoCaptureNetWorthSnapshot({
        showHydrateBanner: false,
        isRefreshing: false,
        hasQueuedPriceRefresh: () => false,
        symbolQuoteUpdatedAt: {},
        isLive: false,
        data: { investments: [] } as unknown as FinancialData,
      }),
    ).toBe(true);
  });

  it('blocks capture when tracked symbols lack fresh timestamps', () => {
    expect(
      canAutoCaptureNetWorthSnapshot({
        showHydrateBanner: false,
        isRefreshing: false,
        hasQueuedPriceRefresh: () => false,
        symbolQuoteUpdatedAt: {},
        isLive: true,
        data: baseData,
      }),
    ).toBe(false);
  });

  it('quoteRefreshFingerprint changes when symbol timestamps change', () => {
    const symbols = getTrackedQuoteSymbolsFromData(baseData);
    const a = quoteRefreshFingerprint(symbols, { AAPL: '2026-05-01T00:00:00.000Z' });
    const b = quoteRefreshFingerprint(symbols, { AAPL: '2026-05-02T00:00:00.000Z' });
    expect(a).not.toBe(b);
  });
});
