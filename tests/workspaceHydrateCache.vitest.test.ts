import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildWorkspaceHydrateCachePayload,
  clearWorkspaceHydrateCache,
  readWorkspaceHydrateCache,
  writeWorkspaceHydrateCache,
} from '../services/workspaceHydrateCache';
import type { FinancialData } from '../types';

const userId = 'user-abc';

function mockLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
}

function sampleData(): FinancialData {
  return {
    accounts: [{ id: 'a1', user_id: userId, name: 'Cash', type: 'Cash', balance: 100, currency: 'SAR' } as any],
    assets: [],
    liabilities: [],
    goals: [],
    transactions: [{ id: 't1', user_id: userId, accountId: 'a1', amount: -10, date: '2026-01-01' } as any],
    investments: [{ id: 'p1', user_id: userId, name: 'Core', holdings: [], accountId: 'a1' } as any],
    investmentTransactions: [],
    budgets: [],
    watchlist: [],
    settings: { user_id: userId, month_start_day: 1 } as any,
    commodityHoldings: [],
    notifications: [],
    zakatPayments: [],
    priceAlerts: [],
    plannedTrades: [],
    investmentPlan: {} as any,
    wealthUltraConfig: {} as any,
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    recurringTransactions: [],
    budgetRequests: [],
    allTransactions: [],
    allBudgets: [],
  };
}

describe('workspaceHydrateCache', () => {
  beforeEach(() => {
    mockLocalStorage();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips cacheable workspace rows for the same user', () => {
    const data = sampleData();
    writeWorkspaceHydrateCache(userId, data);
    const cached = readWorkspaceHydrateCache(userId);
    expect(cached?.accounts).toHaveLength(1);
    expect(cached?.transactions).toHaveLength(1);
    expect(cached?.investments).toHaveLength(1);
  });

  it('rejects stale or mismatched user cache', () => {
    const payload = buildWorkspaceHydrateCachePayload(userId, sampleData());
    payload.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(`finova_ws_hydrate_v1_${userId}`, JSON.stringify(payload));
    expect(readWorkspaceHydrateCache(userId)).toBeNull();
    expect(readWorkspaceHydrateCache('other-user')).toBeNull();
  });

  it('clearWorkspaceHydrateCache removes stored snapshot', () => {
    writeWorkspaceHydrateCache(userId, sampleData());
    expect(readWorkspaceHydrateCache(userId)).not.toBeNull();
    clearWorkspaceHydrateCache(userId);
    expect(readWorkspaceHydrateCache(userId)).toBeNull();
  });
});
