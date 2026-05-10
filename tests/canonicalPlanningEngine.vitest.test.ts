import { describe, expect, it } from 'vitest';
import { computeCanonicalPlanningSnapshot } from '../services/canonicalPlanningEngine';
import type { DataContextFinancialData } from '../types';

function makeData(overrides: Partial<DataContextFinancialData> = {}): DataContextFinancialData {
  const base: DataContextFinancialData = {
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
    settings: {} as any,
    zakatPayments: [],
    priceAlerts: [],
    plannedTrades: [],
    investmentPlan: {} as any,
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    notifications: [],
    personalAccounts: [],
    personalAssets: [],
    personalLiabilities: [],
    personalInvestments: [],
    personalCommodityHoldings: [],
    personalTransactions: [],
  };
  return { ...base, ...overrides } as DataContextFinancialData;
}

describe('computeCanonicalPlanningSnapshot', () => {
  it('computes investment-plan spot/trigger status deterministically', () => {
    const data = makeData({
      plannedTrades: [
        {
          id: 'p1',
          symbol: 'AAPL',
          name: 'Apple',
          tradeType: 'buy',
          conditionType: 'price',
          targetValue: 100,
          priority: 'High',
          status: 'Planned',
        } as any,
      ],
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { AAPL: { price: 90, change: 0 } },
      getAvailableCashForAccount: () => ({ SAR: 0, USD: 0 }),
    });

    expect(snap.investmentPlan.rows).toHaveLength(1);
    expect(snap.investmentPlan.rows[0].spotPrice).toBe(90);
    expect(snap.investmentPlan.rows[0].triggerPrice).toBe(100);
    expect(snap.investmentPlan.rows[0].statusLabel).toBe('Favorable');
    expect(snap.investmentPlan.rows[0].cash.status).toBe('unknown_notional');
    expect(snap.investmentPlan.prioritizedPricePlans.length).toBe(1);
  });

  it('flags stale quotes and marks decision as non-actionable', () => {
    const data = makeData({
      plannedTrades: [
        {
          id: 'p1',
          symbol: 'AAPL',
          name: 'Apple',
          tradeType: 'buy',
          conditionType: 'price',
          targetValue: 100,
          priority: 'High',
          status: 'Planned',
        } as any,
      ],
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { AAPL: { price: 90, change: 0 } },
      getAvailableCashForAccount: () => ({ SAR: 0, USD: 0 }),
      symbolQuoteUpdatedAt: { AAPL: new Date('2020-01-01T00:00:00.000Z').toISOString() },
      nowMs: new Date('2026-01-02T12:00:00.000Z').getTime(),
    });

    const row = snap.investmentPlan.rows[0];
    expect(row.spotQuoteFreshness.isStale).toBe(true);
    expect(row.decision.canDecide).toBe(false);
    expect(row.decision.reasons.join(' ')).toMatch(/stale/i);
  });

  it('buy notional vs deployable: insufficient blocks full decision', () => {
    const data = makeData({
      personalAccounts: [{ id: 'inv1', type: 'Investment', currency: 'SAR' } as any],
      personalInvestments: [
        {
          id: 'pf1',
          name: 'Test PF',
          accountId: 'inv1',
          currency: 'SAR',
          holdings: [{ id: 'h1', symbol: '2222.SR', quantity: 10, avgCost: 100, currentValue: 1000 } as any],
        } as any,
      ],
      plannedTrades: [
        {
          id: 'p1',
          symbol: '2222.SR',
          name: 'Local',
          tradeType: 'buy',
          conditionType: 'price',
          targetValue: 50,
          amount: 500000,
          priority: 'High',
          status: 'Planned',
        } as any,
      ],
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { '2222.SR': { price: 48, change: 0 } },
      symbolQuoteUpdatedAt: { '2222.SR': new Date().toISOString() },
      getAvailableCashForAccount: () => ({ SAR: 1000, USD: 0 }),
    });
    const row = snap.investmentPlan.rows[0];
    expect(row.cash.scope).toBe('holding_accounts');
    expect(row.cash.status).toBe('insufficient');
    expect(row.decision.canDecide).toBe(false);
  });

  it('buy cash uses explicit portfolio venue when set', () => {
    const data = makeData({
      personalAccounts: [
        { id: 'inv-rich', type: 'Investment', currency: 'SAR' } as any,
        { id: 'inv-poor', type: 'Investment', currency: 'SAR' } as any,
      ],
      personalInvestments: [
        {
          id: 'pf-rich',
          name: 'Main',
          accountId: 'inv-rich',
          holdings: [],
        } as any,
        {
          id: 'pf-poor',
          name: 'Side',
          accountId: 'inv-poor',
          holdings: [{ id: 'h1', symbol: '2222.SR', quantity: 10, avgCost: 100, currentValue: 1000 } as any],
        } as any,
      ],
      plannedTrades: [
        {
          id: 'p1',
          symbol: '2222.SR',
          name: 'Local',
          tradeType: 'buy',
          conditionType: 'price',
          targetValue: 50,
          amount: 5000,
          priority: 'High',
          status: 'Planned',
          portfolioId: 'pf-rich',
        } as any,
      ],
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { '2222.SR': { price: 48, change: 0 } },
      symbolQuoteUpdatedAt: { '2222.SR': new Date().toISOString() },
      getAvailableCashForAccount: (id) =>
        id === 'inv-rich' ? { SAR: 10000, USD: 0 } : { SAR: 100, USD: 0 },
    });
    const row = snap.investmentPlan.rows[0];
    expect(row.cash.scope).toBe('explicit_portfolio');
    expect(row.cash.status).toBe('sufficient');
  });

  it('computes deployable cash in SAR from account cash buckets', () => {
    const data = makeData({
      personalAccounts: [{ id: 'acc1', type: 'Investment', currency: 'SAR' } as any],
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      simulatedPrices: {},
      getAvailableCashForAccount: () => ({ SAR: 1000, USD: 10 }),
    });

    expect(snap.recoveryPlan.deployableCashSar).toBeCloseTo(1000 + 10 * snap.sarPerUsd, 6);
  });
});

