/**
 * Regression anchors for user-reported fixes (run via `npm test` or `npm run verify:regressions`).
 */
import { describe, it, expect } from 'vitest';
import { buildUnifiedFinancialContext, roundRiskScore0to100 } from '../services/engineIntegration';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import type { Account, InvestmentPortfolio, InvestmentTransaction, TradeCurrency } from '../types';

describe('regression: portfolio goal API shape → app shape', () => {
  it('maps goal_id to goalId like DataContext fetch', () => {
    const row = { id: 'p1', name: 'Book', account_id: 'acc1', goal_id: 'goal-uuid-1', holdings: [] };
    const mapped = {
      ...row,
      accountId: row.account_id,
      goalId: (row as { goal_id?: string; goalId?: string }).goal_id ?? (row as { goalId?: string }).goalId,
    };
    expect(mapped.goalId).toBe('goal-uuid-1');
  });
});

describe('regression: risk score rounding', () => {
  it('roundRiskScore0to100 clamps and uses one decimal', () => {
    expect(roundRiskScore0to100(37.45538495439759)).toBe(37.5);
    expect(roundRiskScore0to100(100)).toBe(100);
    expect(roundRiskScore0to100(-5)).toBe(0);
  });

  it('buildUnifiedFinancialContext exposes rounded portfolio risk', () => {
    const inv = [
      {
        id: 'i1',
        symbol: 'TEST',
        quantity: 10,
        shares: 10,
        averageCost: 100,
        avgCost: 100,
        currentPrice: 100,
        type: 'stock',
      },
    ];
    const ctx = buildUnifiedFinancialContext([], [], [], [], inv as any);
    const r = ctx.risk.currentPortfolioRisk;
    expect(r).toBe(Math.round(r * 10) / 10);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  });
});

describe('regression: SAR platform metrics module', () => {
  it('deposit SAR counts as invested', () => {
    const platformId = 'inv-acc';
    const portfolios: InvestmentPortfolio[] = [
      { id: 'pf1', name: 'SAR', accountId: platformId, currency: 'SAR' as TradeCurrency, holdings: [] },
    ];
    const accounts = [{ id: platformId, name: 'P', type: 'Investment', balance: 0 }] as Account[];
    const tx: InvestmentTransaction[] = [
      {
        id: 't1',
        accountId: platformId,
        date: '2025-01-01',
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: 5000,
        currency: 'SAR',
      },
    ];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions: tx,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: 3.75,
      availableCashByCurrency: { SAR: 5000, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(5000, 4);
    expect(m.totalWithdrawn).toBe(0);
  });
});
