import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlanDashboardCompareContext,
  loadPlanDashboardCompareContext,
  PLAN_DASHBOARD_COMPARE_STORAGE_KEY,
  savePlanDashboardCompareContext,
} from '../services/planDashboardCompareContext';

function mockSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

describe('planDashboardCompareContext', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', mockSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips Plan YTD snapshot in sessionStorage', () => {
    savePlanDashboardCompareContext({
      year: 2026,
      planYtdActualNetSar: 120_000,
      planYtdProjectedNetSar: 100_000,
    });
    const loaded = loadPlanDashboardCompareContext();
    expect(loaded?.year).toBe(2026);
    expect(loaded?.planYtdActualNetSar).toBe(120_000);
    expect(loaded?.planYtdProjectedNetSar).toBe(100_000);
    expect(sessionStorage.getItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY)).toBeTruthy();
  });

  it('expires after max age', () => {
    savePlanDashboardCompareContext({ year: 2026, planYtdActualNetSar: 1 });
    const raw = sessionStorage.getItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY)!;
    const j = JSON.parse(raw);
    j.savedAt = Date.now() - 31 * 60 * 1000;
    sessionStorage.setItem(PLAN_DASHBOARD_COMPARE_STORAGE_KEY, JSON.stringify(j));
    expect(loadPlanDashboardCompareContext()).toBeNull();
  });

  it('clear removes storage', () => {
    savePlanDashboardCompareContext({ year: 2026, planYtdActualNetSar: 1 });
    clearPlanDashboardCompareContext();
    expect(loadPlanDashboardCompareContext()).toBeNull();
  });
});
