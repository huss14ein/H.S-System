/**
 * Holding Today P/L: open qty after sells + buy-day marks from purchase price.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  buildSameDayTradeIndex,
  computeHoldingDailyPnLInBookCurrency,
  resolveHoldingDailyPnLQuantityBreakdown,
} from '../services/holdingDailyPnL';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import { sanitizeLiveQuoteRow } from '../services/tadawulQuoteSanity';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const holding = (partial: Partial<Holding> & Pick<Holding, 'symbol' | 'quantity'>): Holding => ({
  id: partial.id ?? 'h1',
  symbol: partial.symbol,
  name: partial.name ?? partial.symbol,
  quantity: partial.quantity,
  avgCost: partial.avgCost ?? 100,
  currentValue: partial.currentValue ?? partial.quantity * (partial.avgCost ?? 100),
  zakahClass: 'Zakatable',
  realizedPnL: 0,
  holdingType: partial.holdingType,
});

describe('holding daily P/L quantity breakdown', () => {
  it('excludes shares sold today from overnight mark quantity', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(60, {
      boughtQty: 0,
      soldQty: 40,
      buys: [],
    });
    expect(b.startOfDayQty).toBe(100);
    expect(b.overnightStillHeld).toBe(60);
    expect(b.boughtStillHeld).toBe(0);
  });

  it('FIFO: sells hit overnight first, then today buys', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(20, {
      boughtQty: 50,
      soldQty: 40,
      buys: [{ quantity: 50, priceBook: 100, dateYmd: '2026-09-25' }],
    });
    expect(b.startOfDayQty).toBe(10);
    expect(b.overnightStillHeld).toBe(0);
    expect(b.boughtStillHeld).toBe(20);
  });

  it('no same-day trades → full current qty is overnight', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(15, { boughtQty: 0, soldQty: 0, buys: [] });
    expect(b.overnightStillHeld).toBe(15);
    expect(b.boughtStillHeld).toBe(0);
  });
});

describe('computeHoldingDailyPnLInBookCurrency', () => {
  const asOf = new Date('2026-09-25T15:00:00+03:00');
  const asOfYmd = '2026-09-25';

  it('no trades: change × current quantity', () => {
    const h = holding({ symbol: 'AAPL', quantity: 10, avgCost: 100 });
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2, changePercent: 1.85 } },
      transactions: [],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(20, 6);
  });

  it('sell today: only remaining shares get prior-close day move', () => {
    const h = holding({ symbol: 'AAPL', quantity: 6, avgCost: 100 });
    const txs: InvestmentTransaction[] = [
      {
        id: 's1',
        accountId: 'a1',
        portfolioId: 'p1',
        date: asOfYmd,
        type: 'sell',
        symbol: 'AAPL',
        quantity: 4,
        price: 108,
        total: 432,
      },
    ];
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2, changePercent: 1.85 } },
      transactions: txs,
      asOf,
      asOfYmd,
    });
    // start 10, sold 4 → overnight still 6 × $2 = $12 (not 10×2)
    expect(pnl).toBeCloseTo(12, 6);
  });

  it('buy today: new shares mark from buy price, not full day change', () => {
    const h = holding({ symbol: 'AAPL', quantity: 15, avgCost: 100 });
    const txs: InvestmentTransaction[] = [
      {
        id: 'b1',
        accountId: 'a1',
        portfolioId: 'p1',
        date: asOfYmd,
        type: 'buy',
        symbol: 'AAPL',
        quantity: 5,
        price: 108,
        total: 540,
      },
    ];
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2, changePercent: 1.85 } },
      transactions: txs,
      asOf,
      asOfYmd,
    });
    // overnight 10 × $2 = 20; bought 5 × (110−108) = 10; total 30 (not 15×2=30 by coincidence — assert structure)
    expect(pnl).toBeCloseTo(30, 6);
    // If wrongly applied full day change to all 15: also 30. Change buy price to prove:
    const pnl2 = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2, changePercent: 1.85 } },
      transactions: [{ ...txs[0], price: 109, total: 545 }],
      asOf,
      asOfYmd,
    });
    // overnight 20 + bought 5×(110−109)=5 → 25; naive change×qty would still be 30
    expect(pnl2).toBeCloseTo(25, 6);
  });

  it('uses changePercent when change is zero', () => {
    const h = holding({ symbol: 'AAPL', quantity: 10, avgCost: 100 });
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 100, change: 0, changePercent: 2 } },
      transactions: [],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(20, 6);
  });

  it('manual fund holdings → 0', () => {
    const h = holding({ symbol: 'FUND', quantity: 10, holdingType: 'manual_fund' });
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: h,
      portfolioId: 'p1',
      bookCurrency: 'SAR',
      sarPerUsd: 3.75,
      simulatedPrices: { FUND: { price: 10, change: 1 } },
      transactions: [],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBe(0);
  });
});

describe('platform Daily P/L uses trade-aware holding helper', () => {
  it('sell today reduces platform dailyPnL vs full start qty', () => {
    const asOf = new Date('2026-09-25T15:00:00+03:00');
    const portfolio: InvestmentPortfolio = {
      id: 'p1',
      name: 'Main',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding({ symbol: 'AAPL', quantity: 6, avgCost: 100, currentValue: 660 })],
    };
    const txs: InvestmentTransaction[] = [
      {
        id: 's1',
        accountId: 'acc1',
        portfolioId: 'p1',
        date: '2026-09-25',
        type: 'sell',
        symbol: 'AAPL',
        quantity: 4,
        price: 108,
        total: 432,
      },
    ];
    const live = { AAPL: { price: 110, change: 2 } };
    const metrics = computePlatformCardMetrics({
      portfolios: [portfolio],
      transactions: txs,
      accounts: [{ id: 'acc1', name: 'Broker', type: 'Investment', balance: 0 }],
      allInvestments: [portfolio],
      sarPerUsd: 3.75,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: live,
      dailyPnLPrices: live,
      platformCurrency: 'USD',
      asOf,
    });
    expect(metrics.dailyPnLSAR).toBeCloseTo(12 * 3.75, 4);
  });
});

describe('Tadawul day change scales with price normalization', () => {
  it('sanitizeLiveQuoteRow scales change when price is divided by 100', () => {
    const row = sanitizeLiveQuoteRow('2222.SR', { price: 3200, change: -400, changePercent: -1.25 }, {
      avgCostPerShare: 32,
    });
    expect(row?.price).toBe(32);
    expect(row?.change).toBeCloseTo(-4, 6);
  });
});

describe('Today column wiring E2E', () => {
  it('Investments holdings table uses computeHoldingDailyPnLInBookCurrency', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('computeHoldingDailyPnLInBookCurrency');
    expect(page).toContain('buildSameDayTradeIndex');
    expect(page).toContain('sameDayTradeIndex');
    expect(page).not.toMatch(/quoteDailyPnLInBookCurrency\(\s*liveQuoteRow\.change/);
  });

  it('platform metrics daily loop uses holding daily helper', () => {
    const src = read('services/investmentPlatformCardMetrics.ts');
    expect(src).toContain('computeHoldingDailyPnLInBookCurrency');
    expect(src).toContain('buildSameDayTradeIndex');
  });

  it('index builder scopes by calendar day and portfolio', () => {
    const idx = buildSameDayTradeIndex(
      [
        {
          id: '1',
          accountId: 'a',
          portfolioId: 'p1',
          date: '2026-09-25',
          type: 'sell',
          symbol: 'AAPL',
          quantity: 3,
          price: 1,
          total: 3,
        },
        {
          id: '2',
          accountId: 'a',
          portfolioId: 'p1',
          date: '2026-09-24',
          type: 'sell',
          symbol: 'AAPL',
          quantity: 99,
          price: 1,
          total: 99,
        },
        {
          id: '3',
          accountId: 'a',
          portfolioId: 'p2',
          date: '2026-09-25',
          type: 'sell',
          symbol: 'AAPL',
          quantity: 7,
          price: 1,
          total: 7,
        },
      ],
      '2026-09-25',
    );
    expect(idx.get('p1::AAPL')?.soldQty).toBe(3);
    expect(idx.get('p2::AAPL')?.soldQty).toBe(7);
  });
});
