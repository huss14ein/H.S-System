/**
 * Portfolio quote sync + week/month KPI + Tadawul guards — E2E wiring and behavior.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRefreshableHoldingQuoteSymbols,
  portfolioHasRefreshableQuoteSymbols,
} from '../services/quoteRefreshSymbols';
import { computePortfolioMarkToMarketPeriodPnLSar } from '../services/portfolioPeriodPnL';
import { buildEquityHoldingValueUpdatesFromTrustedSnapshot } from '../services/marketSimulatorHoldingPersist';
import { holdingUsesLiveQuote } from '../utils/holdingValuation';
import type { FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('portfolio sync + KPI completion', () => {
  it('wiring: portfolio scope sync, no platform sync button, forceFetch skips cache seed', () => {
    expect(read('context/MarketDataContext.tsx')).toContain("kind: 'portfolio'");
    expect(read('context/MarketDataContext.tsx')).toContain('refreshPricesForPortfolio');
    expect(read('components/MarketSimulator.tsx')).toContain('scopeIsPortfolio');
    expect(read('components/MarketSimulator.tsx')).toContain('skipCacheSeed');
    expect(read('components/MarketSimulator.tsx')).toContain('allowCacheFallback');
    expect(read('pages/Investments.tsx')).toContain('refreshPricesForPortfolio');
    expect(read('pages/Investments.tsx')).toContain('portfolioHasRefreshableQuoteSymbols');
    expect(read('pages/Investments.tsx')).not.toContain('refreshPricesForPlatform(');
    expect(read('components/investments/InvestmentsQuoteStatusBanner.tsx')).toContain('Sync quotes');
    expect(read('components/investments/InvestmentsQuoteStatusBanner.tsx')).not.toContain('on a platform');
  });

  it('legacy holdingType equity still uses live quotes; manual_fund does not', () => {
    expect(holdingUsesLiveQuote({ holdingType: 'equity' })).toBe(true);
    expect(holdingUsesLiveQuote({ holdingType: 'ticker' })).toBe(true);
    expect(holdingUsesLiveQuote({ holdingType: 'manual_fund' })).toBe(false);
    expect(
      portfolioHasRefreshableQuoteSymbols({
        currency: 'SAR',
        holdings: [{ symbol: '2222.SR', holdingType: 'equity', quantity: 1, avgCost: 10 } as any],
      }),
    ).toBe(true);
    expect(
      portfolioHasRefreshableQuoteSymbols({
        currency: 'SAR',
        holdings: [{ symbol: '2222.SR', holdingType: 'manual_fund', quantity: 1, avgCost: 10 } as any],
      }),
    ).toBe(false);
  });

  it('SAR book bare letter tickers route to .SR for SAHMK fetch', () => {
    const syms = getRefreshableHoldingQuoteSymbols(
      [{ symbol: 'REITF', holdingType: 'ticker' }],
      { bookCurrency: 'SAR' },
    );
    expect(syms).toEqual(['REITF.SR']);
  });

  it('week P/L uses cost at period start and live at end (imported holdings, no ledger txs)', () => {
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Tadawul',
        accountId: 'acc-1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 50,
            avgCost: 30,
            currentValue: 1600,
            zakahClass: 'Zakatable',
            realizedPnL: 0,
            holdingType: 'equity',
          },
        ],
      },
    ];
    const data = {
      accounts: [{ id: 'acc-1', name: 'Derayah', type: 'Investment', balance: 0 }],
      investments: portfolios,
      investmentTransactions: [] as InvestmentTransaction[],
      personalInvestments: portfolios,
    } as FinancialData;

    const now = new Date(2026, 4, 20);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const period = computePortfolioMarkToMarketPeriodPnLSar({
      portfolio: portfolios[0],
      transactions: [],
      startMs: weekStart.getTime(),
      endMs: now.getTime(),
      endValueSar: 1600,
      includeCash: true,
      singlePortfolioOnAccount: true,
      accounts: data.accounts!,
      portfolios,
      data,
      sarPerUsd: 3.75,
      simulatedPrices: { '2222.SR': { price: 32, change: 0.5, changePercent: 1 } },
    });

    expect(period.totalSar).toBeCloseTo(100, 0);
  });

  it('Investments add-on and trade paths use alias-aware quote lookup', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('lookupLiveQuoteForSymbol(simulatedPrices');
    expect(page).not.toMatch(/simulatedPrices\[[^\]]+\]\?\.price/);
  });

  it('system-wide: alias-safe valuation on overview, universe panel, commodities', () => {
    expect(read('pages/InvestmentOverview.tsx')).toContain('effectiveHoldingValueInBookCurrency');
    expect(read('pages/InvestmentOverview.tsx')).not.toMatch(/simulatedPrices\[[^\]]+\]/);
    expect(read('components/PortfolioUniversePanel.tsx')).toContain('lookupLiveQuoteForSymbol(simulatedPrices');
    expect(read('services/investmentPlatformCardMetrics.ts')).toContain('lookupLiveQuoteForSymbol(simulatedPrices');
    expect(read('pages/WealthUltraDashboard.tsx')).toContain('lookupLiveQuoteForSymbol(simulatedPrices');
  });

  it('Investments metrics: KPI debounced map + separate liveQuotePrices', () => {
    const ctx = read('context/InvestmentsMetricsContext.tsx');
    expect(ctx).toContain('liveQuotePrices');
    expect(ctx).not.toMatch(/return \{ \.\.\.metrics, simulatedPrices: useLiveQuotePrices/);
    expect(read('pages/Investments.tsx')).toContain('simulatedPrices: kpiQuotePrices');
  });

  it('monthly KPI exports use kpiSnapshot (Settings, Analysis) not ad-hoc recompute', () => {
    expect(read('pages/Settings.tsx')).toContain('kpiSnapshot');
    expect(read('pages/Settings.tsx')).not.toContain('computeMonthlyReportFinancialKpis');
    expect(read('pages/Analysis.tsx')).not.toContain('computeMonthlyReportFinancialKpis');
    expect(read('components/DashboardKpiQualityPanel.tsx')).not.toContain('computeMonthlyReportFinancialKpis');
  });

  it('period P/L surfaces use live quote hook', () => {
    expect(read('pages/Investments.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('pages/WealthAnalytics.tsx')).toContain('useLiveQuotePrices');
  });

  it('persist path passes portfolio book currency into quote refresh eligibility', () => {
    expect(read('services/marketSimulatorHoldingPersist.ts')).toContain('bookCurrency: book');
  });

  it('Tadawul valuation omits stale storedPricePerShare from sanitize context', () => {
    const val = read('utils/holdingValuation.ts');
    expect(val).not.toContain('storedPricePerShare');
  });

  it('Tadawul persist uses avg cost sanitization (halala cache corrected)', () => {
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 100,
            avgCost: 32,
            currentValue: 3200,
            holdingType: 'ticker',
          } as any,
        ],
      } as any,
    ];
    const updates = buildEquityHoldingValueUpdatesFromTrustedSnapshot(
      portfolios,
      { '2222.SR': { price: 3200, change: 0, changePercent: 0 } },
      3.75,
    );
    expect(updates).toEqual([{ id: 'h1', currentValue: 3200 }]);
  });
});
