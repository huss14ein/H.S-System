import { describe, expect, it } from 'vitest';
import type { FinancialData, PlannedTrade, TradeCurrency, UniverseTicker } from '../types';
import { buildInvestmentEngineUniverse } from '../services/investmentEngine/universe';
import { generateInvestmentPlanSuggestions } from '../services/investmentEngine/suggestions';
import { applySuggestedPlansLocally } from '../services/investmentEngine/planWriter';

describe('investmentEngine', () => {
  it('treats Tadawul aliases as one symbol for quotes and mapping', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          name: 'PF',
          accountId: 'a1',
          currency: 'SAR' as TradeCurrency,
          holdings: [{ id: 'h1', symbol: 'TADAWUL:2222', name: 'Aramco', quantity: 10, avgCost: 10, currentValue: 1000 }],
        },
      ],
      portfolioUniverse: [{ id: 'u1', ticker: '2222.SR', name: 'Saudi Aramco', status: 'Core', monthly_weight: 0.1, max_position_weight: 0.3 } as any],
      commodityHoldings: [],
      assets: [],
      sukukPayoutSchedules: [],
      sukukPayoutEvents: [],
      plannedTrades: [],
      investmentPlan: { monthlyBudget: 1000, budgetCurrency: 'SAR', executionCurrency: 'USD', coreAllocation: 0.7, upsideAllocation: 0.3 },
      settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
      accounts: [],
      liabilities: [],
      goals: [],
      transactions: [],
      budgets: [],
      watchlist: [],
      zakatPayments: [],
      priceAlerts: [],
      notifications: [],
      statusChangeLog: [],
      executionLogs: [],
      allTransactions: [],
      allBudgets: [],
      wealthUltraConfig: {} as any,
      budgetRequests: [],
      recurringTransactions: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const u = buildInvestmentEngineUniverse({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { '2222.SR': { price: 30 } },
    });

    const inst = u.instruments.find((x) => x.kind === 'equity');
    expect(inst?.symbol).toBe('2222.SR');
    expect(inst?.status).toBe('Core');
    expect(inst?.priceNow).toBe(30);
  });

  it('builds a unified universe across equities, commodities, and sukuk', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          name: 'PF',
          accountId: 'a1',
          currency: 'USD' as TradeCurrency,
          holdings: [{ id: 'h1', symbol: 'AAPL', name: 'Apple', quantity: 2, avgCost: 100, currentValue: 300 }],
        },
      ],
      portfolioUniverse: [
        { id: 'u1', ticker: 'AAPL', name: 'Apple', status: 'Core', monthly_weight: 0.05, max_position_weight: 0.2 } as unknown as UniverseTicker,
        { id: 'u2', ticker: 'MSFT', name: 'Microsoft', status: 'High-Upside', monthly_weight: 0.03, max_position_weight: 0.15 } as unknown as UniverseTicker,
      ],
      commodityHoldings: [{ id: 'c1', name: 'Gold', quantity: 10, unit: 'gram', purchaseValue: 1000, currentValue: 1200, symbol: 'XAU_GRAM_24K', zakahClass: 'Zakatable' }],
      assets: [{ id: 'as1', name: 'Sukuk Fund', type: 'Sukuk', value: 5000 }],
      sukukPayoutSchedules: [],
      sukukPayoutEvents: [],
      plannedTrades: [],
      investmentPlan: { monthlyBudget: 1000, budgetCurrency: 'SAR', executionCurrency: 'USD', coreAllocation: 0.7, upsideAllocation: 0.3 },
      settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
      accounts: [],
      liabilities: [],
      goals: [],
      transactions: [],
      budgets: [],
      watchlist: [],
      zakatPayments: [],
      priceAlerts: [],
      notifications: [],
      statusChangeLog: [],
      executionLogs: [],
      allTransactions: [],
      allBudgets: [],
      wealthUltraConfig: {} as any,
      budgetRequests: [],
      recurringTransactions: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const u = buildInvestmentEngineUniverse({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { AAPL: { price: 200 }, MSFT: { price: 300 } },
    });

    expect(u.instruments.some((x) => x.kind === 'equity' && x.symbol === 'AAPL')).toBe(true);
    expect(u.instruments.some((x) => x.kind === 'equity' && x.symbol === 'MSFT' && x.positionValueSar === 0)).toBe(true); // unheld universe row
    expect(u.instruments.some((x) => x.kind === 'commodity' && x.symbol.includes('XAU'))).toBe(true);
    expect(u.instruments.some((x) => x.kind === 'sukuk' && x.symbol === 'SUKUK:as1')).toBe(true);
    expect(u.totals.totalSar).toBeGreaterThan(0);
  });

  it('generates buy/sell drafts with plain-language explanations', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          name: 'PF',
          accountId: 'a1',
          currency: 'USD' as TradeCurrency,
          holdings: [
            { id: 'h1', symbol: 'AAA', name: 'AAA', quantity: 1, avgCost: 10, currentValue: 100 },
            { id: 'h2', symbol: 'BBB', name: 'BBB', quantity: 1, avgCost: 10, currentValue: 100 },
          ],
        },
      ],
      portfolioUniverse: [
        { id: 'u1', ticker: 'AAA', name: 'AAA', status: 'Core', monthly_weight: 0.05, max_position_weight: 0.8 } as any,
        { id: 'u2', ticker: 'BBB', name: 'BBB', status: 'Quarantine', monthly_weight: 0.02, max_position_weight: 0.1 } as any,
      ],
      commodityHoldings: [],
      assets: [],
      sukukPayoutSchedules: [],
      sukukPayoutEvents: [],
      plannedTrades: [],
      investmentPlan: { monthlyBudget: 1000, budgetCurrency: 'SAR', executionCurrency: 'USD', coreAllocation: 0.7, upsideAllocation: 0.3 },
      settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275 },
      accounts: [],
      liabilities: [],
      goals: [],
      transactions: [],
      budgets: [],
      watchlist: [],
      zakatPayments: [],
      priceAlerts: [],
      notifications: [],
      statusChangeLog: [],
      executionLogs: [],
      allTransactions: [],
      allBudgets: [],
      wealthUltraConfig: {} as any,
      budgetRequests: [],
      recurringTransactions: [],
      investmentTransactions: [],
    } as unknown as FinancialData;

    const universe = buildInvestmentEngineUniverse({
      data,
      exchangeRate: 3.75,
      simulatedPrices: { AAA: { price: 100 }, BBB: { price: 50 } },
    });

    const out = generateInvestmentPlanSuggestions({
      universe,
      planCurrency: 'SAR',
      monthlyBudget: 1000,
      coreAllocation: 0.7,
      upsideAllocation: 0.3,
      existingPlanKeys: new Set(),
    });

    expect(out.drafts.some((d) => d.kind === 'equity' && d.tradeType === 'buy' && d.symbol === 'AAA' && d.explanation.length > 0)).toBe(true);
    expect(out.drafts.some((d) => d.kind === 'equity' && d.tradeType === 'sell' && d.symbol === 'BBB')).toBe(true);
  });

  it('dedupes drafts into create/update without overwriting user sizing', () => {
    const drafts = [
      {
        draftId: 'buy:AAA',
        kind: 'equity',
        canAutoPlan: true,
        symbol: 'AAA',
        name: 'AAA',
        tradeType: 'buy' as const,
        conditionType: 'price' as const,
        targetValue: 100,
        instrumentCurrency: 'USD' as TradeCurrency,
        amountPlanCurrency: 500,
        priority: 'Medium' as const,
        confidence: 'High' as const,
        severity: 'safe' as const,
        explanation: ['x'],
        tags: [],
      },
    ];

    const existing: PlannedTrade[] = [
      {
        id: 'p1',
        symbol: 'AAA',
        name: 'AAA',
        tradeType: 'buy',
        conditionType: 'price',
        targetValue: 102, // within 3%
        amount: 999, // user set
        quantity: undefined,
        priority: 'High',
        notes: 'user note',
        status: 'Planned',
      } as any,
    ];

    const out = applySuggestedPlansLocally({
      drafts: drafts as any,
      existingPlans: existing,
      planCurrency: 'SAR',
    });

    expect(out.toCreate.length).toBe(0);
    expect(out.toUpdate.length).toBe(1);
    expect(out.toUpdate[0].amount).toBe(999); // preserved
    expect(out.toUpdate[0].targetValue).toBe(100); // updated trigger
  });
});

