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

  it('scopes recovery ladders and budgets to each portfolio platform — not the global cash sum', () => {
    const data = makeData({
      personalAccounts: [
        { id: 'inv-rich', type: 'Investment', name: 'Broker Rich', currency: 'USD' } as any,
        { id: 'inv-dry', type: 'Investment', name: 'Broker Dry', currency: 'USD' } as any,
      ],
      personalInvestments: [
        {
          id: 'pf-rich',
          name: 'Rich Port',
          accountId: 'inv-rich',
          currency: 'USD',
          holdings: [
            {
              id: 'h-rich',
              symbol: 'RICH',
              name: 'Rich Co',
              quantity: 100,
              avgCost: 100,
              currentValue: 7000,
            },
          ],
        } as any,
        {
          id: 'pf-dry',
          name: 'Dry Port',
          accountId: 'inv-dry',
          currency: 'USD',
          holdings: [
            {
              id: 'h-dry',
              symbol: 'DRY',
              name: 'Dry Co',
              quantity: 100,
              avgCost: 100,
              currentValue: 7000,
            },
          ],
        } as any,
      ],
      portfolioUniverse: [
        { ticker: 'RICH', status: 'Core' },
        { ticker: 'DRY', status: 'Core' },
      ] as any,
    });

    const snap = computeCanonicalPlanningSnapshot({
      data,
      exchangeRate: 3.75,
      sarPerUsd: 3.75,
      simulatedPrices: {
        RICH: { price: 70, change: -1 },
        DRY: { price: 70, change: -1 },
      },
      symbolQuoteUpdatedAt: {
        RICH: new Date().toISOString(),
        DRY: new Date().toISOString(),
      },
      getAvailableCashForAccount: (id) =>
        id === 'inv-rich' ? { SAR: 0, USD: 20000 } : { SAR: 0, USD: 0 },
    });

    const rich = snap.recoveryPlan.positions.find((p) => p.holding.symbol === 'RICH');
    const dry = snap.recoveryPlan.positions.find((p) => p.holding.symbol === 'DRY');
    expect(rich?.accountId).toBe('inv-rich');
    expect(dry?.accountId).toBe('inv-dry');
    expect(rich?.platformDeployableCashSar).toBeCloseTo(20000 * 3.75, 0);
    expect(dry?.platformDeployableCashSar).toBe(0);
    expect(snap.recoveryPlan.recoveryBudgetByAccountId['inv-rich']).toBeGreaterThan(0);
    expect(snap.recoveryPlan.recoveryBudgetByAccountId['inv-dry'] ?? 0).toBe(0);

    const richDecision = snap.recoveryPlan.rankedDecisions.find((d) => d.symbol === 'RICH');
    const dryDecision = snap.recoveryPlan.rankedDecisions.find((d) => d.symbol === 'DRY');
    // Dry broker cannot take an add_ladder just because rich broker has cash.
    expect(dryDecision?.action).not.toBe('add_ladder');
    expect(dry?.platformDeployableCashSar).toBeLessThan(rich?.platformDeployableCashSar ?? 0);
    // Rich may still be add_ladder / recycle / wait depending on trigger — but its budget is its own.
    expect(richDecision?.accountId).toBe('inv-rich');
    expect(dryDecision?.accountId).toBe('inv-dry');
  });
});

