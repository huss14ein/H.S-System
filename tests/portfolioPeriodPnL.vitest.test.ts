import { describe, expect, it } from 'vitest';
import {
  computePortfolioLedgerPnLSarInRange,
  computePortfolioLedgerPnLSarInRangeWithFifo,
  computePortfolioMarkToMarketPeriodPnLSar,
  computePortfolioPeriodPnLSummary,
  computePortfolioPnLDailySeries,
  platformPeriodPnLFromSummary,
  portfolioPeriodPnLInputsFingerprint,
  reconstructSeededStartCashSar,
  resolvePeriodStartValueSar,
  resolvePortfolioPeriodPnLEndValueSar,
} from '../services/portfolioPeriodPnL';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import type { Account, FinancialData, InvestmentCostLot, InvestmentPortfolio, InvestmentTransaction } from '../types';

describe('portfolioPeriodPnL', () => {
  it('reconstructSeededStartCashSar treats buys as cash→holdings, not P/L', () => {
    expect(
      reconstructSeededStartCashSar({ endCashSar: 2000, externalFlowSar: 0, buyCostSar: 1336 }),
    ).toBe(3336);
    expect(
      reconstructSeededStartCashSar({ endCashSar: 5000, externalFlowSar: 1000, buyCostSar: 0 }),
    ).toBe(4000);
  });

  it('resolvePeriodStartValueSar reconstructs for any seeded portfolio when endCashSar is set', () => {
    const { startCashSar, startValueSar } = resolvePeriodStartValueSar({
      holdingsStartSar: 1000,
      includeCash: true,
      ledgerExplainsHoldings: false,
      singlePortfolioOnAccount: false,
      startStateCashSar: 0,
      endCashSar: 500,
      externalFlowSar: 0,
      buyCostSar: 200,
    });
    expect(startCashSar).toBe(700);
    expect(startValueSar).toBe(1700);
  });

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

  it('FIFO ledger P/L uses oldest lot cost when investment_cost_lots exist', () => {
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
        quantity: 5,
        price: 100,
        total: 500,
        currency: 'SAR',
      },
      {
        id: 'b2',
        accountId: 'acc-1',
        portfolioId: 'p1',
        date: '2026-05-05',
        type: 'buy',
        symbol: 'AAA.SR',
        quantity: 5,
        price: 200,
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
        price: 150,
        total: 750,
        currency: 'SAR',
      },
    ];
    const costLots: InvestmentCostLot[] = [
      {
        id: 'l1',
        portfolioId: 'p1',
        symbol: 'AAA.SR',
        market: 'Tadawul',
        acquisitionDate: '2026-05-01',
        quantityRemaining: 5,
        costPerShare: 100,
        bookCurrency: 'SAR',
      },
      {
        id: 'l2',
        portfolioId: 'p1',
        symbol: 'AAA.SR',
        market: 'Tadawul',
        acquisitionDate: '2026-05-05',
        quantityRemaining: 5,
        costPerShare: 200,
        bookCurrency: 'SAR',
      },
    ];
    const data = {
      accounts,
      investments: portfolios,
      investmentTransactions: txs,
      personalInvestments: portfolios,
      investmentCostLots: costLots,
    } as FinancialData;

    const startMs = new Date(2026, 4, 15).getTime();
    const endMs = new Date(2026, 4, 28, 23, 59, 59).getTime();

    const wacLedger = computePortfolioLedgerPnLSarInRange({
      transactions: txs,
      startMs,
      endMs,
      accounts,
      portfolios,
      data,
      sarPerUsd: 3.75,
    });
    // WAC avg cost 150 → sell 5 @ 150 → zero realized
    expect(wacLedger).toBeCloseTo(0, 0);

    const fifoLedger = computePortfolioLedgerPnLSarInRangeWithFifo({
      transactions: txs,
      startMs,
      endMs,
      accounts,
      portfolios,
      data,
      sarPerUsd: 3.75,
      portfolioId: 'p1',
      costLots,
    });
    // FIFO oldest lot @ 100 → sell 5 @ 150 → 250 realized
    expect(fifoLedger).toBeCloseTo(250, 0);
  });

  it('mark-to-market period P/L uses period-open marks (not cost) when provided', () => {
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

    const live = { '2222.SR': { price: 12, change: 0.5, changePercent: 1 } };
    // Without historical open marks, start falls back to live → flat week ≈ 0 (not lifetime vs cost).
    const flat = computePortfolioMarkToMarketPeriodPnLSar({
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
      simulatedPrices: live,
    });
    expect(flat.totalSar).toBeCloseTo(0, 0);

    // With week-open mark at 10 and live end at 12 → true +200 period move.
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
      simulatedPrices: live,
      periodStartPrices: { '2222.SR': { price: 10 } },
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
      periodStartPrices: { '2222.SR': { price: 10 } },
    });

    // Open mark 10 → end 12 on 100 shares; not 7× daily change.
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
      weekPeriodStartPrices: { '2222.SR': { price: 10 } },
      monthPeriodStartPrices: { '2222.SR': { price: 10 } },
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
      weekPeriodStartPrices: { '2222.SR': { price: 10 } },
      monthPeriodStartPrices: { '2222.SR': { price: 10 } },
      monthStartDay: 1,
      now,
    };
    const summary = computePortfolioPeriodPnLSummary(args);
    const series = computePortfolioPnLDailySeries(args);
    expect(series.weekly.length).toBeGreaterThan(0);
    expect(series.monthly.length).toBeGreaterThan(0);
    expect(summary.weeklyTotalSar).toBeCloseTo(200, 0);
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

  it('week P/L reflects buy during period with mark-to-market gain', () => {
    const accounts: Account[] = [{ id: 'acc-1', name: 'Broker', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
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
    };
    const now = new Date(2026, 4, 25);
    const buyDate = '2026-05-20';
    const depositDate = '2026-05-20';
    const txs: InvestmentTransaction[] = [
      {
        id: 'dep1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'deposit',
        date: depositDate,
        total: 1000,
        currency: 'SAR',
      },
      {
        id: 'buy1',
        accountId: 'acc-1',
        portfolioId: 'p1',
        symbol: '2222.SR',
        type: 'buy',
        date: buyDate,
        quantity: 100,
        total: 1000,
        currency: 'SAR',
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
      simulatedPrices: { '2222.SR': { price: 12, change: 0, changePercent: 0 } },
      // Buy is inside the week — open marks unused for pre-buy empty book; keep explicit for clarity.
      weekPeriodStartPrices: { '2222.SR': { price: 12 } },
      monthPeriodStartPrices: { '2222.SR': { price: 12 } },
      monthStartDay: 1,
      now,
    });

    const row = summary.rows[0]!;
    // In-period buy @ 10 marked to 12 → +200 (same for week & month when buy is in both windows).
    expect(row.weekly.totalSar).toBeCloseTo(200, 0);
    expect(row.monthly.totalSar).toBeCloseTo(200, 0);

    const series = computePortfolioPnLDailySeries({
      data,
      portfolios: [p1],
      accounts,
      sarPerUsd: 3.75,
      simulatedPrices: { '2222.SR': { price: 12, change: 0, changePercent: 0 } },
      weekPeriodStartPrices: { '2222.SR': { price: 12 } },
      monthPeriodStartPrices: { '2222.SR': { price: 12 } },
      monthStartDay: 1,
      now,
      summary,
    });
    expect(series.weekly[series.weekly.length - 1]?.cumulativeSar).toBeCloseTo(200, 0);
  });

  it('seeded portfolio: in-period buy from existing cash is not fake Week P/L', () => {
    // Reproduces the Investments hub bug: deposits-only ledger → seed holdings → exclude
    // in-period buy symbols → startCash=endCash made buy notional look like gains (~75k Week).
    const accounts: Account[] = [{ id: 'acc-1', name: 'Awaed', type: 'Investment', balance: 0 }];
    const p1: InvestmentPortfolio = {
      id: 'p1',
      name: "Hussein's Awaed",
      accountId: 'acc-1',
      currency: 'USD',
      holdings: [
        {
          id: 'h-old',
          symbol: 'UNH',
          quantity: 10,
          avgCost: 400,
          currentValue: 4500,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'equity',
        },
        {
          id: 'h-new',
          symbol: 'SNAP',
          quantity: 250,
          avgCost: 5.3448,
          currentValue: 1400,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'equity',
        },
      ],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 'd-old',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'deposit',
        date: '2024-01-15',
        total: 20000,
        currency: 'USD',
      },
      {
        id: 'buy-snap',
        accountId: 'acc-1',
        portfolioId: 'p1',
        type: 'buy',
        symbol: 'SNAP',
        date: '2026-06-20',
        quantity: 250,
        price: 5.3448,
        total: 1336.2,
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
    const sarPerUsd = 3.75;
    const buyCostSar = 1336.2 * sarPerUsd; // ~5010
    const endCashUsd = 2000;
    const now = new Date(2026, 5, 25); // Jun 25 — buy is in week/month

    const period = computePortfolioMarkToMarketPeriodPnLSar({
      portfolio: p1,
      transactions: txs,
      startMs: new Date(2026, 5, 19).getTime(),
      endMs: new Date(2026, 5, 25, 23, 59, 59).getTime(),
      // holdings mark + cash
      endValueSar: (4500 + 1400 + endCashUsd) * sarPerUsd,
      endCashSar: endCashUsd * sarPerUsd,
      includeCash: true,
      singlePortfolioOnAccount: true,
      accounts,
      portfolios: [p1],
      data,
      sarPerUsd,
      simulatedPrices: {
        UNH: { price: 450, change: 0, changePercent: 0 },
        SNAP: { price: 5.6, change: 0, changePercent: 0 },
      },
    });

    // Must NOT be ~buyCostSar (~5k) as fake gain.
    // UNH held through the week at flat live 450 → 0 period move.
    // SNAP bought in-window: end 1400 − buy 1336.2 ≈ 63.8 USD unrealized ≈ 239 SAR.
    expect(period.totalSar).toBeLessThan(buyCostSar);
    expect(period.totalSar).toBeCloseTo(63.8 * sarPerUsd, 0);

    const summary = computePortfolioPeriodPnLSummary({
      data,
      portfolios: [p1],
      accounts,
      sarPerUsd,
      simulatedPrices: {
        UNH: { price: 450, change: 0, changePercent: 0 },
        SNAP: { price: 5.6, change: 0, changePercent: 0 },
      },
      monthStartDay: 1,
      getAvailableCashForAccount: () => ({ SAR: 0, USD: endCashUsd }),
      now,
    });
    expect(Math.abs(summary.rows[0]!.weekly.totalSar)).toBeLessThan(buyCostSar);
    expect(summary.rows[0]!.weekly.totalSar).toBeCloseTo(63.8 * sarPerUsd, 0);

    const series = computePortfolioPnLDailySeries({
      data,
      portfolios: [p1],
      accounts,
      sarPerUsd,
      simulatedPrices: {
        UNH: { price: 450, change: 0, changePercent: 0 },
        SNAP: { price: 5.6, change: 0, changePercent: 0 },
      },
      monthStartDay: 1,
      getAvailableCashForAccount: () => ({ SAR: 0, USD: endCashUsd }),
      now,
      summary,
    });
    expect(series.weekly[series.weekly.length - 1]?.cumulativeSar).toBeCloseTo(summary.rows[0]!.weekly.totalSar, 0);
  });

  it('portfolioPeriodPnLInputsFingerprint changes when holding currentValue updates', () => {
    const p1: InvestmentPortfolio = {
      id: 'p1',
      name: 'Core',
      accountId: 'acc-1',
      currency: 'SAR',
      holdings: [
        {
          id: 'h1',
          symbol: '2222.SR',
          quantity: 10,
          avgCost: 30,
          currentValue: 300,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          holdingType: 'manual_fund',
        },
      ],
    };
    const data = { investmentTransactions: [] } as FinancialData;
    const a = portfolioPeriodPnLInputsFingerprint({
      data,
      portfolios: [p1],
      sarPerUsd: 3.75,
      monthStartDay: 1,
      simulatedPrices: {},
    });
    const b = portfolioPeriodPnLInputsFingerprint({
      data,
      portfolios: [
        {
          ...p1,
          holdings: [{ ...p1.holdings![0], currentValue: 350 }],
        },
      ],
      sarPerUsd: 3.75,
      monthStartDay: 1,
      simulatedPrices: {},
    });
    expect(a).not.toBe(b);
  });
});
