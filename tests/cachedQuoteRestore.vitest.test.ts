import { describe, it, expect } from 'vitest';
import {
  computeRestoreCachedQuotesPatch,
  latestQuoteCacheTimestamp,
  symbolTimestampsFromCacheRows,
} from '../services/cachedQuoteRestore';
import type { FinancialData } from '../types';

const sampleData: FinancialData = {
  accounts: [],
  assets: [],
  liabilities: [],
  goals: [],
  transactions: [],
  investments: [
    {
      id: 'p1',
      name: 'Test',
      accountId: 'a1',
      currency: 'USD',
      holdings: [{ id: 'h1', symbol: 'AAPL', quantity: 10, currentValue: 0, avgCostPerShare: 100 }],
    },
  ],
  investmentTransactions: [],
  budgets: [],
  watchlist: [],
  settings: {} as FinancialData['settings'],
  zakatPayments: [],
  priceAlerts: [],
  commodityHoldings: [],
  plannedTrades: [],
  notifications: [],
  investmentPlan: null,
  wealthUltraConfig: {} as FinancialData['wealthUltraConfig'],
  portfolioUniverse: [],
  statusChangeLog: [],
  executionLogs: [],
  recurringTransactions: [],
  budgetRequests: [],
  allTransactions: [],
  allBudgets: [],
};

describe('cachedQuoteRestore', () => {
  it('symbolTimestampsFromCacheRows maps fetchedAt to ISO keys', () => {
    const ts = symbolTimestampsFromCacheRows({
      AAPL: { price: 100, change: 0, changePercent: 0, fetchedAt: 1_700_000_000_000 },
    });
    expect(ts.AAPL).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('computeRestoreCachedQuotesPatch applies cached quote to holding notionals', () => {
    const rows = {
      AAPL: { price: 200, change: 1, changePercent: 0.5, fetchedAt: Date.now() },
    };
    const patch = computeRestoreCachedQuotesPatch(sampleData, 3.75, rows);
    expect(patch.hasCache).toBe(true);
    expect(patch.equityUpdates.length).toBe(1);
    expect(patch.equityUpdates[0]!.currentValue).toBeGreaterThan(0);
    expect(latestQuoteCacheTimestamp(rows)).toBeTruthy();
  });
});
