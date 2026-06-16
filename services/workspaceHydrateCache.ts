import type { FinancialData } from '../types';
import { financialDataHasHydrated } from './financialDataHydration';

const CACHE_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap cached ledger rows so localStorage stays under quota on large workspaces. */
const MAX_CACHED_TRANSACTIONS = 4000;
const MAX_CACHED_INVESTMENT_TX = 4000;

export type WorkspaceHydrateCachePayload = {
  version: number;
  userId: string;
  savedAt: number;
  data: Pick<
    FinancialData,
    | 'accounts'
    | 'assets'
    | 'liabilities'
    | 'goals'
    | 'transactions'
    | 'investments'
    | 'investmentTransactions'
    | 'budgets'
    | 'watchlist'
    | 'settings'
    | 'commodityHoldings'
  >;
};

function cacheStorageKey(userId: string): string {
  return `finova_ws_hydrate_v${CACHE_VERSION}_${userId}`;
}

function trimNewest<T extends { id?: string; date?: string }>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  return rows.slice(0, max);
}

export function buildWorkspaceHydrateCachePayload(
  userId: string,
  data: FinancialData,
): WorkspaceHydrateCachePayload {
  return {
    version: CACHE_VERSION,
    userId,
    savedAt: Date.now(),
    data: {
      accounts: data.accounts ?? [],
      assets: data.assets ?? [],
      liabilities: data.liabilities ?? [],
      goals: data.goals ?? [],
      transactions: trimNewest(data.transactions ?? [], MAX_CACHED_TRANSACTIONS),
      investments: data.investments ?? [],
      investmentTransactions: trimNewest(data.investmentTransactions ?? [], MAX_CACHED_INVESTMENT_TX),
      budgets: data.budgets ?? [],
      watchlist: data.watchlist ?? [],
      settings: data.settings,
      commodityHoldings: data.commodityHoldings ?? [],
    },
  };
}

export function readWorkspaceHydrateCache(userId: string): FinancialData | null {
  if (typeof localStorage === 'undefined' || !userId) return null;
  try {
    const raw = localStorage.getItem(cacheStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceHydrateCachePayload;
    if (parsed.version !== CACHE_VERSION || parsed.userId !== userId) return null;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    const merged = {
      accounts: parsed.data.accounts ?? [],
      assets: parsed.data.assets ?? [],
      liabilities: parsed.data.liabilities ?? [],
      goals: parsed.data.goals ?? [],
      transactions: parsed.data.transactions ?? [],
      investments: parsed.data.investments ?? [],
      investmentTransactions: parsed.data.investmentTransactions ?? [],
      budgets: parsed.data.budgets ?? [],
      watchlist: parsed.data.watchlist ?? [],
      settings: parsed.data.settings,
      commodityHoldings: parsed.data.commodityHoldings ?? [],
    } as FinancialData;
    return financialDataHasHydrated(merged) ? merged : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceHydrateCache(userId: string, data: FinancialData): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  try {
    const payload = buildWorkspaceHydrateCachePayload(userId, data);
    localStorage.setItem(cacheStorageKey(userId), JSON.stringify(payload));
  } catch {
    try {
      const slim = buildWorkspaceHydrateCachePayload(userId, {
        ...data,
        transactions: trimNewest(data.transactions ?? [], 1500),
        investmentTransactions: trimNewest(data.investmentTransactions ?? [], 1500),
      });
      localStorage.setItem(cacheStorageKey(userId), JSON.stringify(slim));
    } catch {
      // Quota or serialization — skip cache write; network hydrate still works.
    }
  }
}

export function clearWorkspaceHydrateCache(userId: string): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  try {
    localStorage.removeItem(cacheStorageKey(userId));
  } catch {
    // ignore
  }
}
