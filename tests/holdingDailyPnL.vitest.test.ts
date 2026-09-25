/**
 * Holding Today P/L: open qty after sells + buy-day marks from purchase price.
 * Covers all trade-day scenarios, FX, aliases, and validation guards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  buildSameDayTradeIndex,
  computeCommodityDailyPnLSar,
  computeHoldingDailyPnLInBookCurrency,
  lookupSameDayTradeSummary,
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

const tx = (
  partial: Partial<InvestmentTransaction> &
    Pick<InvestmentTransaction, 'id' | 'type' | 'symbol' | 'quantity' | 'price'>,
): InvestmentTransaction => ({
  accountId: partial.accountId ?? 'a1',
  portfolioId: partial.portfolioId ?? 'p1',
  date: partial.date ?? '2026-09-25',
  total: partial.total ?? partial.quantity * partial.price,
  currency: partial.currency,
  ...partial,
});

describe('holding daily P/L quantity breakdown', () => {
  it('excludes shares sold today from overnight mark quantity', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(60, {
      boughtQty: 0,
      soldQty: 40,
      buys: [],
      sells: [],
    });
    expect(b.startOfDayQty).toBe(100);
    expect(b.overnightStillHeld).toBe(60);
    expect(b.boughtStillHeld).toBe(0);
  });

  it('FIFO: sells hit overnight first, then today buys', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(20, {
      boughtQty: 50,
      soldQty: 40,
      buys: [{ quantity: 50, price: 100, dateYmd: '2026-09-25' }],
      sells: [],
    });
    expect(b.startOfDayQty).toBe(10);
    expect(b.overnightStillHeld).toBe(0);
    expect(b.boughtStillHeld).toBe(20);
  });

  it('no same-day trades → full current qty is overnight', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(15, { boughtQty: 0, soldQty: 0, buys: [], sells: [] });
    expect(b.overnightStillHeld).toBe(15);
    expect(b.boughtStillHeld).toBe(0);
  });

  it('sell exceeds start-of-day (oversold ledger) clamps overnight to 0', () => {
    const b = resolveHoldingDailyPnLQuantityBreakdown(5, {
      boughtQty: 10,
      soldQty: 100,
      buys: [{ quantity: 10, price: 50, dateYmd: '2026-09-25' }],
      sells: [],
    });
    expect(b.overnightStillHeld).toBe(0);
    expect(b.boughtStillHeld).toBe(5);
    expect(b.overnightStillHeld + b.boughtStillHeld).toBe(5);
  });

  it('NaN / negative current quantity → zeros', () => {
    expect(resolveHoldingDailyPnLQuantityBreakdown(Number.NaN, null).currentQty).toBe(0);
    expect(resolveHoldingDailyPnLQuantityBreakdown(-3, null).currentQty).toBe(0);
  });
});

describe('computeHoldingDailyPnLInBookCurrency', () => {
  const asOf = new Date('2026-09-25T15:00:00+03:00');
  const asOfYmd = '2026-09-25';

  it('no trades: change × current quantity', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
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
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 6 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 4, price: 108 })],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(12, 6);
  });

  it('buy today: new shares mark from buy price, not full day change', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 15 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [tx({ id: 'b1', type: 'buy', symbol: 'AAPL', quantity: 5, price: 109 })],
      asOf,
      asOfYmd,
    });
    // overnight 10×2=20 + bought 5×(110−109)=5 → 25 (naive 15×2=30)
    expect(pnl).toBeCloseTo(25, 6);
  });

  it('multiple buys at different prices allocate FIFO after overnight sells', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 12 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [
        tx({ id: 'b1', type: 'buy', symbol: 'AAPL', quantity: 4, price: 108 }),
        tx({ id: 'b2', type: 'buy', symbol: 'AAPL', quantity: 3, price: 109 }),
        tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 5, price: 110 }),
      ],
      asOf,
      asOfYmd,
    });
    // start=10, sell 5 overnight → overnight still 5×2=10
    // buys 7, none sold from buys → 4×(110−108)+3×(110−109)=8+3=11; total 21
    expect(pnl).toBeCloseTo(21, 6);
  });

  it('partial day-trade: sell into today’s buys after overnight depleted', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 20 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [
        tx({ id: 'b1', type: 'buy', symbol: 'AAPL', quantity: 50, price: 108 }),
        tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 40, price: 109 }),
      ],
      asOf,
      asOfYmd,
    });
    // start=10, sell 40 → overnight 0; bought still 20 × (110−108)=40
    expect(pnl).toBeCloseTo(40, 6);
  });

  it('US ticker in SAR book converts overnight day move', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
      portfolioId: 'p1',
      bookCurrency: 'SAR',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(20 * 3.75, 6);
  });

  it('buy price in USD converts into SAR book for midday buy MTM', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 5 }),
      portfolioId: 'p1',
      bookCurrency: 'SAR',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [
        tx({
          id: 'b1',
          type: 'buy',
          symbol: 'AAPL',
          quantity: 5,
          price: 108,
          currency: 'USD',
        }),
      ],
      asOf,
      asOfYmd,
    });
    // all bought today: (110−108)×5 × 3.75
    expect(pnl).toBeCloseTo(2 * 5 * 3.75, 6);
  });

  it('symbol alias: holding 1120.SR matches sell recorded as 1120', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: '1120.SR', quantity: 6, avgCost: 80 }),
      portfolioId: 'p1',
      bookCurrency: 'SAR',
      sarPerUsd: 3.75,
      simulatedPrices: { '1120.SR': { price: 90, change: 1 } },
      transactions: [tx({ id: 's1', type: 'sell', symbol: '1120', quantity: 4, price: 89 })],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(6, 6);
  });

  it('uses changePercent when change is zero', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
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
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'FUND', quantity: 10, holdingType: 'manual_fund' }),
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

  it('missing quote / invalid FX / zero qty → 0', () => {
    const base = {
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
      portfolioId: 'p1',
      bookCurrency: 'USD' as const,
      asOf,
      asOfYmd,
      transactions: [] as InvestmentTransaction[],
    };
    expect(
      computeHoldingDailyPnLInBookCurrency({
        ...base,
        sarPerUsd: 3.75,
        simulatedPrices: {},
      }),
    ).toBe(0);
    expect(
      computeHoldingDailyPnLInBookCurrency({
        ...base,
        sarPerUsd: 0,
        simulatedPrices: { AAPL: { price: 110, change: 2 } },
      }),
    ).toBe(0);
    expect(
      computeHoldingDailyPnLInBookCurrency({
        ...base,
        holding: holding({ symbol: 'AAPL', quantity: 0 }),
        sarPerUsd: 3.75,
        simulatedPrices: { AAPL: { price: 110, change: 2 } },
      }),
    ).toBe(0);
  });

  it('ignores non-buy/sell same-day txs (dividend/deposit)', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [
        tx({ id: 'd1', type: 'dividend', symbol: 'AAPL', quantity: 0, price: 0, total: 5 }),
        tx({ id: 'dep', type: 'deposit', symbol: '', quantity: 0, price: 0, total: 1000 }),
      ],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(20, 6);
  });

  it('does not apply another portfolio’s same-day sell', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 10 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [
        tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 9, price: 110, portfolioId: 'p2' }),
      ],
      asOf,
      asOfYmd,
    });
    expect(pnl).toBeCloseTo(20, 6);
  });

  it('invalid buy price falls back to prior-close day move for those shares', () => {
    const pnl = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 5 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [tx({ id: 'b1', type: 'buy', symbol: 'AAPL', quantity: 5, price: Number.NaN })],
      asOf,
      asOfYmd,
    });
    // All bought today, buy price invalid → 5 × $2 day change
    expect(pnl).toBeCloseTo(10, 6);
  });
});

describe('same-day trade index', () => {
  it('scopes by calendar day and portfolio; aliases share a key', () => {
    const idx = buildSameDayTradeIndex(
      [
        tx({ id: '1', type: 'sell', symbol: '1120.SR', quantity: 3, price: 1, date: '2026-09-25' }),
        tx({ id: '2', type: 'sell', symbol: '1120', quantity: 2, price: 1, date: '2026-09-25' }),
        tx({ id: '3', type: 'sell', symbol: '1120.SR', quantity: 99, price: 1, date: '2026-09-24' }),
        tx({ id: '4', type: 'sell', symbol: '1120.SR', quantity: 7, price: 1, date: '2026-09-25', portfolioId: 'p2' }),
      ],
      '2026-09-25',
    );
    const p1 = lookupSameDayTradeSummary(idx, 'p1', '1120');
    expect(p1.soldQty).toBe(5);
    expect(lookupSameDayTradeSummary(idx, 'p2', '1120.SR').soldQty).toBe(7);
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
      holdings: [holding({ symbol: 'AAPL', quantity: 6, currentValue: 660 })],
    };
    const live = { AAPL: { price: 110, change: 2 } };
    const metrics = computePlatformCardMetrics({
      portfolios: [portfolio],
      transactions: [tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 4, price: 108, accountId: 'acc1' })],
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
    const row = sanitizeLiveQuoteRow(
      '2222.SR',
      { price: 3200, change: -400, changePercent: -1.25 },
      { avgCostPerShare: 32 },
    );
    expect(row?.price).toBe(32);
    expect(row?.change).toBeCloseTo(-4, 6);
  });
});

describe('Today column wiring E2E', () => {
  it('Investments holdings table uses breakdown helper + tooltip', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('computeHoldingDailyPnLBreakdown');
    expect(page).toContain('formatHoldingDailyPnLBreakdownTitle');
    expect(page).toContain('buildSameDayTradeIndex');
    expect(page).toContain('sameDayTradeIndex');
    expect(page).toContain('dailyPnLPrefs');
    expect(page).not.toMatch(/quoteDailyPnLInBookCurrency\(\s*liveQuoteRow\.change/);
  });

  it('platform metrics daily loop uses holding daily helper', () => {
    const src = read('services/investmentPlatformCardMetrics.ts');
    expect(src).toContain('computeHoldingDailyPnLInBookCurrency');
    expect(src).toContain('buildSameDayTradeIndex');
    expect(src).toContain('computeCommodityDailyPnLSar');
  });

  it('Settings exposes Today P/L preference toggles', () => {
    const page = read('pages/Settings.tsx');
    expect(page).toContain('includeRealizedFromSells');
    expect(page).toContain('zeroOutsideSession');
  });

  it('Overview surfaces Today movers', () => {
    const page = read('pages/InvestmentOverview.tsx');
    expect(page).toContain('todayMovers');
    expect(page).toContain('computeHoldingDailyPnLBreakdown');
  });
});

describe('enhancement scenarios', () => {
  const asOf = new Date('2026-09-25T15:00:00+03:00');
  const asOfYmd = '2026-09-25';

  it('includeRealizedFromSells adds overnight sell day P/L', () => {
    const open = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 6 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 4, price: 109 })],
      asOf,
      asOfYmd,
      includeRealizedFromSells: false,
    });
    const withRealized = computeHoldingDailyPnLInBookCurrency({
      holding: holding({ symbol: 'AAPL', quantity: 6 }),
      portfolioId: 'p1',
      bookCurrency: 'USD',
      sarPerUsd: 3.75,
      simulatedPrices: { AAPL: { price: 110, change: 2 } },
      transactions: [tx({ id: 's1', type: 'sell', symbol: 'AAPL', quantity: 4, price: 109 })],
      asOf,
      asOfYmd,
      includeRealizedFromSells: true,
    });
    // open: 6×2=12; realized: 4×(109−108)=4 → 16
    expect(open).toBeCloseTo(12, 6);
    expect(withRealized).toBeCloseTo(16, 6);
  });

  it('stock_dividend same-day adds qty marked from prior close', () => {
    const idx = buildSameDayTradeIndex([], asOfYmd, {
      corporateActionEvents: [
        {
          id: 'ca1',
          portfolioId: 'p1',
          actionType: 'stock_dividend',
          symbol: 'AAPL',
          executionDate: asOfYmd,
          ratioNumerator: 11,
          ratioDenominator: 10,
          idempotencyKey: 'ca1',
          status: 'applied',
        },
      ],
      holdingsForCa: [{ portfolioId: 'p1', symbol: 'AAPL', quantity: 110 }],
    });
    const row = lookupSameDayTradeSummary(idx, 'p1', 'AAPL');
    expect(row.boughtQty).toBeCloseTo(10, 6);
    expect(row.buys[0]?.source).toBe('ca_stock_dividend');
  });

  it('computeCommodityDailyPnLSar uses changePercent; non-listed symbols ignore session gate', () => {
    const openSat = new Date('2026-06-06T18:00:00Z');
    expect(
      computeCommodityDailyPnLSar({
        symbol: 'XAU-LOCAL',
        quantity: 2,
        quote: { price: 2000, change: 0, changePercent: 1 },
        asOf: openSat,
        zeroOutsideSession: false,
      }),
    ).toBeCloseTo(40, 6);
    expect(
      computeCommodityDailyPnLSar({
        symbol: 'XAU-LOCAL',
        quantity: 2,
        quote: { price: 2000, change: 5 },
        asOf: openSat,
        zeroOutsideSession: true,
      }),
    ).toBeCloseTo(10, 6);
  });
});
