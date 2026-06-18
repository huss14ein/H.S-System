/**
 * Daily P/L session gate + live quotes + Investments perf — full path E2E guards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import { quoteDailyPnLInBookCurrency } from '../utils/currencyMath';

import type { Account, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('market session daily P/L E2E', () => {
  it('single helper gates all book-currency daily P/L math', () => {
    expect(read('utils/currencyMath.ts')).toContain('quoteChangeForDailyPnL');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('quoteDailyPnLInBookCurrency');
    expect(read('pages/Investments.tsx')).toContain('quoteDailyPnLInBookCurrency');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('dailyPnLSAR');
  });

  it('quoteDailyPnLInBookCurrency uses provider day change outside session', () => {
    const satEt = new Date('2026-06-06T18:00:00Z');
    expect(
      quoteDailyPnLInBookCurrency(2, 10, 'AAPL', 'USD', 3.75, satEt),
    ).toBe(20);
  });

  it('platform card metrics use live quote change for daily P/L outside session', () => {
    const satEt = new Date('2026-06-06T18:00:00Z');
    const holding: Holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1100,
      zakahClass: 'Zakatable',
    };
    const portfolio: InvestmentPortfolio = {
      id: 'p1',
      name: 'Main',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding],
    };
    const account: Account = { id: 'acc1', name: 'Broker', type: 'Investment', balance: 0 };
    const live = { AAPL: { price: 110, change: 2 } };
    const metrics = computePlatformCardMetrics({
      portfolios: [portfolio],
      transactions: [] as InvestmentTransaction[],
      accounts: [account],
      allInvestments: [portfolio],
      sarPerUsd: 3.75,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: live,
      dailyPnLPrices: live,
      platformCurrency: 'USD',
      asOf: satEt,
    });
    expect(metrics.dailyPnLSAR).toBeCloseTo(20 * 3.75, 4);
  });

  it('platform card derives daily P/L from changePercent when change is zero', () => {
    const holding: Holding = {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1100,
      zakahClass: 'Zakatable',
    };
    const portfolio: InvestmentPortfolio = {
      id: 'p1',
      name: 'Main',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [holding],
    };
    const account: Account = { id: 'acc1', name: 'Broker', type: 'Investment', balance: 0 };
    const live = { AAPL: { price: 110, change: 0, changePercent: 2 } };
    const metrics = computePlatformCardMetrics({
      portfolios: [portfolio],
      transactions: [] as InvestmentTransaction[],
      accounts: [account],
      allInvestments: [portfolio],
      sarPerUsd: 3.75,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: live,
      dailyPnLPrices: live,
      platformCurrency: 'USD',
    });
    expect(metrics.dailyPnLSAR).toBeCloseTo(10 * 110 * 0.02 * 3.75, 2);
  });

  it('Investments platform card passes dailyPnLPrices from live quotes', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('dailyPnLPrices: throttledPrices');
  });

  it('headline rollup uses same platform card path', () => {
    expect(read('services/investmentKpiCore.ts')).toContain('computePersonalPlatformsRollupSAR');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('computePersonalPlatformCardRow');
  });
});

describe('live quotes E2E wiring', () => {
  it('stale bootstrap + cooldown drain + header force refresh (desktop + mobile)', () => {
    expect(read('components/MarketSimulator.tsx')).toContain('didScheduleStaleRefreshRef');
    expect(read('components/MarketSimulator.tsx')).toContain('silent: true');
    expect(read('components/MarketSimulator.tsx')).toContain('finishQuotesRefresh');
    expect(read('components/Header.tsx')).toMatch(/refreshPrices\(\{ forceFetch: true \}\)/g);
  });
});

describe('Investments expand perf E2E wiring', () => {
  it('platform expand is immediate; KPI bundle deferred', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('React.memo(PlatformCardInner)');
    expect(page).not.toContain('onClick={() => startTransition(onToggleExpanded)}');
    expect(page).toContain('scheduleIdleWorkAsync');
    expect(page).toContain('computePortfolioMetricsBundle');
  });
});
