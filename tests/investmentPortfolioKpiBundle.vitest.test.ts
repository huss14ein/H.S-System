import { describe, expect, it } from 'vitest';
import { computePortfolioMetricsBundle } from '../services/investmentPlatformCardMetrics';
import type { Account, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('computePortfolioMetricsBundle', () => {
  it('exposes full account cash buckets on each portfolio for UI sync; metrics are positions-only cash + filtered txs', () => {
    const account: Account = {
      id: 'acc-1',
      name: 'Inv',
      type: 'Investment',
      balance: 0,
    };
    const p1: InvestmentPortfolio = {
      id: 'port-a',
      name: 'A',
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
      id: 'port-b',
      name: 'B',
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

    const txs: InvestmentTransaction[] = [
      {
        id: 't1',
        accountId: 'acc-1',
        portfolioId: 'port-a',
        symbol: 'CASH',
        type: 'deposit',
        date: new Date().toISOString(),
        total: 500,
        currency: 'SAR',
      },
      {
        id: 't2',
        accountId: 'acc-1',
        portfolioId: 'port-b',
        symbol: 'CASH',
        type: 'deposit',
        date: new Date().toISOString(),
        total: 200,
        currency: 'SAR',
      },
    ];

    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [p1, p2],
      transactions: txs,
      accounts: [account],
      allInvestments: [p1, p2],
      sarPerUsd: 3.75,
      simulatedPrices: {},
      accountAvailableCashByCurrency: { SAR: 1000, USD: 0 },
    });

    const a = bundle.allocatedCashByPortfolioId.get('port-a');
    const b = bundle.allocatedCashByPortfolioId.get('port-b');
    expect(a?.SAR).toBe(1000);
    expect(b?.SAR).toBe(1000);

    const ma = bundle.metricsByPortfolioId.get('port-a')!;
    const mb = bundle.metricsByPortfolioId.get('port-b')!;
    expect(ma.totalInvestedSAR).toBe(500);
    expect(mb.totalInvestedSAR).toBe(200);
    expect(ma.totalValueInSAR).toBeCloseTo(1000, 5);
    expect(mb.totalValueInSAR).toBeCloseTo(3000, 5);
    expect(ma.totalAvailable).toBe(0);
    expect(mb.totalAvailable).toBe(0);
    // Unrealized P/L = holdings value − qty×avg cost (same idea as each holdings row).
    expect(ma.totalGainLossSAR).toBeCloseTo(0, 5);
    expect(mb.totalGainLossSAR).toBeCloseTo(2500, 5);
    expect(ma.unrealizedPnLBasis).toBe('holdings_cost');
  });

  it('repeats full cash buckets for each portfolio when there are no holdings', () => {
    const account: Account = {
      id: 'acc-2',
      name: 'Inv',
      type: 'Investment',
      balance: 0,
    };
    const p1: InvestmentPortfolio = {
      id: 'x',
      name: 'X',
      accountId: 'acc-2',
      currency: 'SAR',
      holdings: [],
    };
    const p2: InvestmentPortfolio = {
      id: 'y',
      name: 'Y',
      accountId: 'acc-2',
      currency: 'SAR',
      holdings: [],
    };
    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [p1, p2],
      transactions: [],
      accounts: [account],
      allInvestments: [p1, p2],
      sarPerUsd: 3.75,
      simulatedPrices: {},
      accountAvailableCashByCurrency: { SAR: 100, USD: 0 },
    });
    expect(bundle.allocatedCashByPortfolioId.get('x')?.SAR).toBe(100);
    expect(bundle.allocatedCashByPortfolioId.get('y')?.SAR).toBe(100);
  });

  it('splits account-level deposit/withdrawal (no portfolioId) by holdings value SAR weights', () => {
    const account: Account = {
      id: 'acc-o',
      name: 'Inv',
      type: 'Investment',
      balance: 0,
    };
    const p1: InvestmentPortfolio = {
      id: 'port-low',
      name: 'Small',
      accountId: 'acc-o',
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
      accountId: 'acc-o',
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

    const txs: InvestmentTransaction[] = [
      {
        id: 'orphan-w',
        accountId: 'acc-o',
        symbol: 'CASH',
        type: 'withdrawal',
        date: new Date().toISOString(),
        total: 400,
        currency: 'SAR',
      },
    ];

    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [p1, p2],
      transactions: txs,
      accounts: [account],
      allInvestments: [p1, p2],
      sarPerUsd: 3.75,
      simulatedPrices: {},
      accountAvailableCashByCurrency: { SAR: 0, USD: 0 },
    });

    const low = bundle.metricsByPortfolioId.get('port-low')!;
    const high = bundle.metricsByPortfolioId.get('port-high')!;
    // Weights 1000 : 3000 → 100 / 300 of 400
    expect(low.totalWithdrawnSAR).toBeCloseTo(100, 5);
    expect(high.totalWithdrawnSAR).toBeCloseTo(300, 5);
  });

  it('with one portfolio, KPI metrics use full tx list + cash + net_capital like the platform header', () => {
    const account: Account = {
      id: 'acc-single',
      name: 'Broker',
      type: 'Investment',
      balance: 0,
    };
    const only: InvestmentPortfolio = {
      id: 'solo',
      name: 'Main',
      accountId: 'acc-single',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: 'FOO.SR',
          quantity: 10,
          avgCost: 100,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };

    const txs: InvestmentTransaction[] = [
      {
        id: 'd1',
        accountId: 'acc-single',
        symbol: 'CASH',
        type: 'deposit',
        date: new Date().toISOString(),
        total: 2000,
        currency: 'SAR',
      },
      {
        id: 'w1',
        accountId: 'acc-single',
        symbol: 'CASH',
        type: 'withdrawal',
        date: new Date().toISOString(),
        total: 400,
        currency: 'SAR',
      },
    ];

    const bundle = computePortfolioMetricsBundle({
      siblingPortfolios: [only],
      transactions: txs,
      accounts: [account],
      allInvestments: [only],
      sarPerUsd: 3.75,
      simulatedPrices: {},
      accountAvailableCashByCurrency: { SAR: 50, USD: 0 },
    });

    const m = bundle.metricsByPortfolioId.get('solo')!;
    expect(m.totalInvestedSAR).toBe(2000);
    expect(m.totalWithdrawnSAR).toBe(400);
    expect(m.netCapitalSAR).toBeCloseTo(1600, 5);
    expect(m.unrealizedPnLBasis).toBeUndefined();
    expect(m.totalValueInSAR).toBeCloseTo(1000 + 50, 5);
  });
});
