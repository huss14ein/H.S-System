import { describe, expect, it } from 'vitest';
import { computePortfolioLedgerPnLSarInRange } from '../services/portfolioPeriodPnL';
import { computePortfolioPeriodPnLSummary } from '../services/portfolioPeriodPnL';
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
    expect(Number.isFinite(summary.rows[0].weekly.totalSar)).toBe(true);
    expect(Number.isFinite(summary.rows[0].monthly.totalSar)).toBe(true);
    expect(summary.weeklyTotalSar).toBe(summary.rows[0].weekly.totalSar);
  });
});
