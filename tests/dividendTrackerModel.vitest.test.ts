import { describe, expect, it } from 'vitest';
import { buildDividendTrackerModel, resolveExpectedAnnualSar } from '../services/dividendTrackerModel';
import type { FinancialData, Holding, InvestmentPortfolio } from '../types';

describe('resolveExpectedAnnualSar', () => {
  const holding: Holding = {
    id: 'h1',
    symbol: 'AAPL',
    name: 'Apple',
    quantity: 10,
    avgCost: 100,
    currentValue: 1000,
    dividendYield: 2,
  };

  it('prefers manual override', () => {
    const r = resolveExpectedAnnualSar({
      holding,
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      manualAnnualSar: 5000,
    });
    expect(r.source).toBe('manual');
    expect(r.annualSar).toBe(5000);
  });

  it('uses holding yield before market', () => {
    const r = resolveExpectedAnnualSar({
      holding,
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      market: { dividendPerShareAnnual: 10, dividendYieldPct: 5, dividendCashCurrency: 'USD' },
    });
    expect(r.source).toBe('holding_yield');
    expect(r.annualSar).toBeCloseTo(1000 * 0.02 * 3.75, 2);
  });

  it('uses market DPS when no holding yield', () => {
    const r = resolveExpectedAnnualSar({
      holding: { ...holding, dividendYield: undefined },
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      market: { dividendPerShareAnnual: 1, dividendCashCurrency: 'USD' },
    });
    expect(r.source).toBe('market_dps');
    expect(r.annualSar).toBeCloseTo(10 * 3.75, 2);
  });
});

describe('buildDividendTrackerModel', () => {
  it('separates received YTD from expected plan', () => {
    const portfolio: InvestmentPortfolio = {
      id: 'p1',
      name: 'Main',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'XOM',
          name: 'Exxon',
          quantity: 5,
          avgCost: 50,
          currentValue: 500,
          dividendYield: 4,
        },
      ],
    };
    const data = {
      accounts: [{ id: 'acc1', name: 'Broker', type: 'Investment', currency: 'USD', balance: 0 }],
      investments: [portfolio],
      investmentTransactions: [
        {
          id: 't1',
          type: 'dividend',
          symbol: 'XOM',
          portfolioId: 'p1',
          accountId: 'acc1',
          date: `${new Date().getFullYear()}-03-15`,
          quantity: 0,
          price: 0,
          total: 100,
          currency: 'USD',
        },
      ],
    } as unknown as FinancialData;

    const model = buildDividendTrackerModel({
      data,
      personalInvestments: [portfolio],
      dividendTransactions: data.investmentTransactions as any,
      accounts: data.accounts as any,
      portfolios: [portfolio],
      uiExchangeRate: 3.75,
      sarPerUsd: 3.75,
      personalAccountIds: ['acc1'],
    });

    expect(model.summary.receivedYtdSar).toBeCloseTo(375, 0);
    expect(model.summary.expectedAnnualSar).toBeGreaterThan(0);
    expect(model.topReceived[0]?.symbol).toBe('XOM');
  });
});
