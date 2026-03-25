/**
 * Targeted regression: SAR transfer → platform, buy/sell economics vs Invested / Withdrawn / P&L
 * (same formulas as Investments PlatformCard via `computePlatformCardMetrics`).
 *
 * Run: `npm run verify:investment-sar-flow` or `npx vitest run tests/investmentSarFlowMetrics.vitest.test.ts`
 */
import { describe, it, expect } from 'vitest';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  computePersonalPlatformsRollupSAR,
  computePlatformCardMetrics,
} from '../services/investmentPlatformCardMetrics';

const SAR_PER_USD = 3.75;
const PLATFORM_ID = 'platform-inv-1';

function basePortfolio(overrides: Partial<InvestmentPortfolio> = {}): InvestmentPortfolio {
  return {
    id: 'pf-sar-1',
    name: 'Tadawul',
    accountId: PLATFORM_ID,
    currency: 'SAR',
    holdings: [],
    ...overrides,
  };
}

function baseAccount(): Account {
  return {
    id: PLATFORM_ID,
    name: 'Investment platform',
    type: 'Investment',
    balance: 0,
  } as Account;
}

function tx(partial: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'id' | 'type' | 'total'>): InvestmentTransaction {
  return {
    accountId: PLATFORM_ID,
    date: '2025-06-15',
    symbol: 'CASH',
    quantity: 0,
    price: 0,
    ...partial,
  } as InvestmentTransaction;
}

describe('SAR platform: transfer, buy context, P&L (PlatformCard metrics)', () => {
  it('deposit in SAR counts as Invested; Withdrawn 0; P&L 0 when cash equals net capital', () => {
    const portfolios = [basePortfolio()];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [
      tx({ id: 'd1', type: 'deposit', total: 10_000, currency: 'SAR' }),
    ];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 10_000, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(10_000, 5);
    expect(m.totalWithdrawn).toBe(0);
    expect(m.totalValue).toBeCloseTo(10_000, 5);
    expect(m.totalGainLoss).toBeCloseTo(0, 5);
  });

  it('withdrawal in SAR increases Withdrawn and P&L when cash on platform is unchanged (e.g. before refresh)', () => {
    const portfolios = [basePortfolio()];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [
      tx({ id: 'd1', type: 'deposit', total: 10_000, currency: 'SAR' }),
      tx({ id: 'w1', type: 'withdrawal', total: 2_000, currency: 'SAR' }),
    ];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 10_000, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(10_000, 5);
    expect(m.totalWithdrawn).toBeCloseTo(2_000, 5);
    expect(m.totalValue).toBeCloseTo(10_000, 5);
    // netCapital 8000, value 10000 → P&L 2000
    expect(m.totalGainLoss).toBeCloseTo(2_000, 5);
  });

  it('buy does not change Invested/Withdrawn; unrealized gain shows in P&L (sim price vs deposits)', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: '2222.SR',
      quantity: 100,
      avgCost: 30,
      currentValue: 3_000,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
    };
    const portfolios = [basePortfolio({ holdings: [holding] })];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [
      tx({ id: 'd1', type: 'deposit', total: 10_000, currency: 'SAR' }),
      tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 100, price: 30, total: 3_000, currency: 'SAR' }),
    ];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 7_000, USD: 0 },
      simulatedPrices: { '2222.SR': { price: 35, change: 0 } },
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(10_000, 5);
    expect(m.totalWithdrawn).toBe(0);
    // 100 * 35 + 7000 cash = 10500
    expect(m.totalValue).toBeCloseTo(10_500, 5);
    expect(m.totalGainLoss).toBeCloseTo(500, 5);
  });

  it('sell: reduced position + higher cash keeps total value consistent; realized move is in holdings + cash, P&L vs same net capital', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: '2222.SR',
      quantity: 50,
      avgCost: 30,
      currentValue: 1_750,
      zakahClass: 'Zakatable',
      realizedPnL: 250,
    };
    const portfolios = [basePortfolio({ holdings: [holding] })];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [
      tx({ id: 'd1', type: 'deposit', total: 10_000, currency: 'SAR' }),
      tx({ id: 'b1', type: 'buy', symbol: '2222.SR', quantity: 100, price: 30, total: 3_000, currency: 'SAR' }),
      tx({ id: 's1', type: 'sell', symbol: '2222.SR', quantity: 50, price: 35, total: 1_750, currency: 'SAR' }),
    ];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 8_750, USD: 0 },
      simulatedPrices: { '2222.SR': { price: 35, change: 0 } },
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(10_000, 5);
    expect(m.totalWithdrawn).toBe(0);
    // 50*35 + 8750 = 10500
    expect(m.totalValue).toBeCloseTo(10_500, 5);
    expect(m.totalGainLoss).toBeCloseTo(500, 5);
  });

  it('US-listed ticker live quote converts into SAR book (FX) for value and daily P/L', () => {
    const holding: Holding = {
      id: 'h-aapl',
      symbol: 'AAPL',
      quantity: 10,
      avgCost: 100,
      currentValue: 1000,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
    };
    const portfolios = [basePortfolio({ currency: 'SAR' as const, holdings: [holding] })];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [tx({ id: 'd1', type: 'deposit', total: 50_000, currency: 'SAR' })];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 50_000, USD: 0 },
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      platformCurrency: 'SAR',
    });
    const stockSar = 110 * 10 * SAR_PER_USD;
    expect(m.totalValueInSAR).toBeCloseTo(50_000 + stockSar, 4);
    expect(m.dailyPnLSAR).toBeCloseTo(2 * 10 * SAR_PER_USD, 4);
  });

  it('deposit without explicit currency infers SAR from single SAR portfolio on platform', () => {
    const portfolios = [basePortfolio()];
    const accounts = [baseAccount()];
    const transactions: InvestmentTransaction[] = [tx({ id: 'd1', type: 'deposit', total: 5_000 })];
    const m = computePlatformCardMetrics({
      portfolios,
      transactions,
      accounts,
      allInvestments: portfolios,
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 5_000, USD: 0 },
      simulatedPrices: {},
      platformCurrency: 'SAR',
    });
    expect(m.totalInvested).toBeCloseTo(5_000, 5);
  });
});

describe('Personal platforms rollup (KPI alignment)', () => {
  it('sums tradable cash across personal investment accounts in SAR', () => {
    const plat2 = 'platform-inv-2';
    const getCash = (id: string) =>
      id === PLATFORM_ID ? { SAR: 4_000, USD: 0 } : { SAR: 6_000, USD: 0 };
    const data = {
      accounts: [baseAccount(), { id: plat2, name: 'Second', type: 'Investment', balance: 0 } as Account],
      investments: [
        basePortfolio({ id: 'p1', accountId: PLATFORM_ID }),
        basePortfolio({ id: 'p2', accountId: plat2 }),
      ],
      investmentTransactions: [],
      transactions: [],
      goals: [],
      commodityHoldings: [],
      assets: [],
      liabilities: [],
    } as unknown as FinancialData;

    const rollup = computePersonalPlatformsRollupSAR(data, SAR_PER_USD, {}, getCash);
    expect(rollup.subtotalSAR).toBeCloseTo(10_000, 5);
    expect(rollup.dailyPnLSAR).toBe(0);
  });
});
