import { describe, expect, it } from 'vitest';
import {
  computePortfolioLedgerPnLSarInRange,
  computePortfolioMarkToMarketPeriodPnLSar,
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
  platformPeriodPnLFromSummary,
  resolvePortfolioPeriodPnLEndValueSar,
} from '../services/portfolioPeriodPnL';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import type { Account, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('portfolioPeriodPnL', () => {
  it('ledger P/L counts sell gain and dividends in range', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Growth',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [],
      },
    ];
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        date: '2026-05-01',
        type: 'buy',
        symbol: 'AAA.SR',
        quantity: 10,
        price: 100,
        total: 1000,
        currency: 'SAR',
      },
      {
        id: 's1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        date: '2026-05-20',
        type: 'sell',
        symbol: 'AAA.SR',
        quantity: 5,
        price: 120,
        total: 600,
        currency: 'SAR',
      },
      {
        id: 'd1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        date: '2026-05-22',
        type: 'dividend',
        symbol: 'AAA.SR',
        quantity: 0,
        price: 0,
        total: 50,
        currency: 'SAR',
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: txs,
      personalInvestments: portfolios,
    } as FinancialData;

    const startMs = new Date(2026, 4, 15).getTime();
    const endMs = new Date(2026, 4, 28, 23, 59, 59).getTime();
    const ledger = computePortfolioLedgerPnLSarInRange({
      transactions: txs,
      startMs,
      endMs,
      accounts,
      portfolios,
      data,
      sarPerUsd: 3.75,
    });
    // Sell: 600 - 5*100 = 100; dividend 50
    expect(ledger).toBeCloseTo(150, 0);
  });

  it('mark-to-market period P/L reflects live vs cost at period start when ledger explains holdings', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Core',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 100,
            avgCost: 10,
            currentValue: 1200,
            zakahClass: 'Zakatable',
            realizedPnL: 0,
            holdingType: 'ticker',
          },
        ],
      },
    ];
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        date: '2026-05-01',
        type: 'buy',
        symbol: '2222.SR',
        quantity: 100,
        price: 10,
        total: 1000,
        currency: 'SAR',
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: txs,
      personalInvestments: portfolios,
      monthStartDay: 1,
    } as FinancialData;

    const now = new Date(2026, 4, 25);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);

    const period = computePortfolioMarkToMarketPeriodPnLSar({
      portfolio: portfolios[0],
      transactions: txs,
      startMs: weekStart.getTime(),
      endMs: weekEnd.getTime(),
      endValueSar: 1200,
      includeCash: true,
      singlePortfolioOnAccount: true,
      accounts,
      portfolios,
      data,
      sarPerUsd: 3.75,
      simulatedPrices: { '2222.SR': { price: 12, change: 0.5, changePercent: 1 } },
    });

    expect(period.totalSar).toBeCloseTo(200, 0);
    expect(period.marketEstimateSar).toBeCloseTo(200, 0);
  });

  it('mark-to-market period P/L does not multiply daily P/L by trading days', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Core',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 100,
            avgCost: 10,
            currentValue: 1200,
            zakahClass: 'Zakatable',
            realizedPnL: 0,
            holdingType: 'equity',
          },
        ],
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: [] as InvestmentTransaction[],
      personalInvestments: portfolios,
      monthStartDay: 1,
    } as FinancialData;

    const now = new Date(2026, 4, 25);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);

    const endValueSar = 1200;
    const period = computePortfolioMarkToMarketPeriodPnLSar({
      portfolio: portfolios[0],
      transactions: [],
      startMs: weekStart.getTime(),
      endMs: weekEnd.getTime(),
      endValueSar,
      includeCash: true,
      accounts,
      portfolios,
      data,
      sarPerUsd: 3.75,
      simulatedPrices: { '2222.SR': { price: 12, change: 0.5, changePercent: 1 } },
    });

    // Same live mark at period end vs cost at start (no flows) → period P/L reflects mark vs cost.
    expect(period.totalSar).toBeCloseTo(200, 0);
    expect(period.ledgerSar).toBeCloseTo(0, 0);
    expect(period.marketEstimateSar).toBeCloseTo(200, 0);
  });

  it('summary returns one row per portfolio with weekly and monthly totals', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Core',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 100,
            avgCost: 10,
            currentValue: 1200,
            zakahClass: 'Zakatable',
            realizedPnL: 0,
            holdingType: 'equity',
          },
        ],
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: [] as InvestmentTransaction[],
      personalInvestments: portfolios,
      monthStartDay: 1,
    } as FinancialData;

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios,
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: {
        '2222.SR': { price: 12, change: 0.5, changePercent: 1 },
      },
      monthStartDay: 1,
      now: new Date(2026, 4, 25),
    });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].portfolioName).toBe('Core');
    expect(summary.rows[0].weekly.totalSar).toBeCloseTo(200, 0);
    expect(summary.weeklyTotalSar).toBe(summary.rows[0].weekly.totalSar);
  });

  it('daily series returns cumulative weekly and monthly points aligned with summary totals', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Core',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 100,
            avgCost: 10,
            currentValue: 1200,
            zakahClass: 'Zakatable',
            realizedPnL: 0,
            holdingType: 'equity',
          },
        ],
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: [] as InvestmentTransaction[],
      personalInvestments: portfolios,
    } as FinancialData;
    const now = new Date(2026, 4, 25);
    const args = {
      data,
      portfolios,
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: { '2222.SR': { price: 12, change: 0.5, changePercent: 1 } },
      monthStartDay: 1,
      now,
    };
    const summary = computePortfolioPeriodPnLSummary(args);
    const series = computePortfolioPnLDailySeries(args);
    expect(series.weekly.length).toBeGreaterThan(0);
    expect(series.monthly.length).toBeGreaterThan(0);
    expect(series.weekly[series.weekly.length - 1]?.cumulativeSar).toBeCloseTo(summary.weeklyTotalSar, 0);
    expect(series.monthly[series.monthly.length - 1]?.cumulativeSar).toBeCloseTo(summary.monthlyTotalSar, 0);
    expect(series.weeklyByPortfolioId.get('p1')?.length).toBe(series.weekly.length);
  });

  it('multi-portfolio week P/L does not treat attributed deposit as a loss', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
      id: 'port-low',
      name: 'Small',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'AAA.SR',
          quantity: 100,
          avgCost: 10,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const p2: InvestmentPortfolio = {
      id: 'port-high',
      name: 'Big',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h2',
          symbol: 'BBB.SR',
          quantity: 50,
          avgCost: 10,
          currentValue: 3000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const now = new Date(2026, 4, 25);
    const depositDate = '2026-05-24';
    const txs: InvestmentTransaction[] = [
      {
        id: 'orphan-d',
        accountId: 'acc-1',
        symbol: 'CASH',
        type: 'deposit',
        date: depositDate,
        total: 1000,
        currency: 'SAR',
      },
    ];
    const data = {
      accounts,
      investments: [p1, p2],
      investmentTransactions: txs,
      personalInvestments: [p1, p2],
      personalAccounts: accounts,
    } as FinancialData;

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios: [p1, p2],
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: {},
      monthStartDay: 1,
      getAvailableCashForAccount: () => ({ SAR: 1000, USD: 0 }),
      now,
    });

    const low = summary.rows.find((r) => r.portfolioId === 'port-low')!;
    const high = summary.rows.find((r) => r.portfolioId === 'port-high')!;
    expect(low.weekly.totalSar).toBeCloseTo(0, 0);
    expect(high.weekly.totalSar).toBeCloseTo(0, 0);

    const platform = platformPeriodPnLFromSummary(summary, 'acc-1');
    expect(platform.weekly.totalSar).toBeCloseTo(0, 0);
  });

  it('resolvePortfolioPeriodPnLEndValueSar adds weighted cash slice for sibling portfolios', () => {
    const metrics = computePlatformCardMetrics({
      portfolios: [
        {
          id: 'p1',
          name: 'A',
          accountId: 'acc',
          currency: 'SAR',
          holdings: [
            {
              id: 'h1',
              symbol: 'AAA.SR',
              quantity: 10,
              avgCost: 100,
              currentValue: 1000,
              zakahClass: 'Zakatable',
              realizedPnL: 0,
              holdingType: 'manual_fund',
            },
          ],
        },
      ],
      transactions: [],
      accounts: [{ id: 'acc', name: 'B', type: 'Investment', balance: 0 }],
      allInvestments: [],
      sarPerUsd: 3.75,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
      unrealizedPnLBasis: 'holdings_cost',
    });
    expect(
      resolvePortfolioPeriodPnLEndValueSar({
        metrics,
        siblingCount: 2,
        portfolioWeight: 0.25,
        accountCashSar: 1000,
      }),
    ).toBeCloseTo(1000 + 250, 0);
  });

  it('week P/L stays near zero when deposits exist but buy txs are missing (imported holdings)', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Awaed', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
      id: 'p1',
      name: 'Growth',
      accountId: 'acc-1',
      currency: 'USD',
      holdings: [
        {
          id: 'h1',
          symbol: 'UNH',
          quantity: 10,
          avgCost: 400,
          currentValue: 4500,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'equity',
        },
        {
          id: 'h2',
          symbol: 'NKE',
          quantity: 20,
          avgCost: 100,
          currentValue: 1900,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'equity',
        },
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'd1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'deposit',
        date: '2024-01-15',
        total: 50000,
        currency: 'USD',
      },
      {
        id: 'd2',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'deposit',
        date: '2025-12-01',
        total: 10000,
        currency: 'USD',
      },
    ];
    const data = {
      accounts,
      investments: [p1],
      investmentTransactions: txs,
      personalInvestments: [p1],
      personalAccounts: accounts,
      monthStartDay: 1,
    } as FinancialData;

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios: [p1],
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: {
        UNH: { price: 450, change: 0, changePercent: 0 },
        NKE: { price: 95, change: 0, changePercent: 0 },
      },
      monthStartDay: 1,
      getAvailableCashForAccount: () => ({ SAR: 0, USD: 3000 }),
      now: new Date(2026, 5, 17),
    });

    const row = summary.rows[0]!;
    expect(Math.abs(row.weekly.totalSar)).toBeLessThan(5000);
    expect(Math.abs(row.monthly.totalSar)).toBeLessThan(5000);
    const platform = platformPeriodPnLFromSummary(summary, 'acc-1');
    expect(Math.abs(platform.weekly.totalSar)).toBeLessThan(5000);
  });
});
