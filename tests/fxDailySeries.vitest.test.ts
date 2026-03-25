import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  loadSarPerUsdByDay,
  recordSarPerUsdForCalendarDay,
  hydrateSarPerUsdDailySeries,
  listDenseSarPerUsdSeries,
  getSarPerUsdForCalendarDay,
} from '../services/fxDailySeries';
import type { FinancialData } from '../types';

const minimalData = (): FinancialData =>
  ({
    accounts: [],
    assets: [],
    liabilities: [],
    goals: [],
    transactions: [],
    recurringTransactions: [],
    investments: [],
    investmentTransactions: [],
    budgets: [],
    commodityHoldings: [],
    watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
    zakatPayments: [],
    priceAlerts: [],
    plannedTrades: [],
    notifications: [],
    investmentPlan: {
      monthlyBudget: 0,
      budgetCurrency: 'SAR',
      executionCurrency: 'USD',
      fxRateSource: 'x',
      coreAllocation: 0.7,
      upsideAllocation: 0.3,
      minimumUpsidePercentage: 25,
      stale_days: 5,
      min_coverage_threshold: 0.8,
      redirect_policy: 'priority',
      target_provider: 'x',
      corePortfolio: [],
      upsideSleeve: [],
      brokerConstraints: {
        allowFractionalShares: false,
        minimumOrderSize: 1,
        roundingRule: 'round',
        leftoverCashRule: 'hold',
      },
    },
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    allTransactions: [],
    allBudgets: [],
    wealthUltraConfig: { fxRate: 3.75, cashReservePct: 12, maxPerTickerPct: 16, riskWeightLow: 1, riskWeightMed: 1.3, riskWeightHigh: 1.65, riskWeightSpec: 2.2, defaultTarget1Pct: 14, defaultTarget2Pct: 27, defaultTrailingPct: 11 },
    budgetRequests: [],
  }) as FinancialData;

describe('fxDailySeries', () => {
  const mem: Record<string, string> = {};
  beforeEach(() => {
    Object.keys(mem).forEach((k) => delete mem[k]);
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in mem ? mem[k]! : null),
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
      clear: () => {
        Object.keys(mem).forEach((k) => delete mem[k]);
      },
      key: (i: number) => Object.keys(mem)[i] ?? null,
      get length() {
        return Object.keys(mem).length;
      },
    } as Storage;
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('hydrates a dense series with one SAR/USD per calendar day', () => {
    const data = minimalData();
    hydrateSarPerUsdDailySeries(data, 3.75, { horizonDays: 5 });
    const map = loadSarPerUsdByDay();
    const keys = Object.keys(map).sort();
    expect(keys.length).toBeGreaterThanOrEqual(5);
    keys.forEach((k) => {
      expect(map[k]).toBeGreaterThan(0);
    });
  });

  it('listDenseSarPerUsdSeries returns consecutive days', () => {
    const data = minimalData();
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setDate(start.getDate() - 3);
    const startDay = start.toISOString().slice(0, 10);
    const series = listDenseSarPerUsdSeries(startDay, end, data, 3.75);
    expect(series.length).toBe(4);
    for (let i = 1; i < series.length; i++) {
      const a = new Date(`${series[i - 1]!.date}T12:00:00`).getTime();
      const b = new Date(`${series[i]!.date}T12:00:00`).getTime();
      expect(b - a).toBe(86400000);
    }
  });

  it('recordSarPerUsdForCalendarDay overrides lookup for that day', () => {
    const data = minimalData();
    hydrateSarPerUsdDailySeries(data, 3.75, { horizonDays: 3 });
    const today = new Date().toISOString().slice(0, 10);
    recordSarPerUsdForCalendarDay(today, 3.8);
    expect(getSarPerUsdForCalendarDay(today, data, 3.75)).toBeCloseTo(3.8, 5);
  });
});
