/**
 * E2E wiring: hybrid incomplete-portfolio ROI + AI fallbacks + version 3.2.1.0
 * across Dashboard, Investments, System Health, canonical metrics, and proxy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  computePersonalInvestmentKpiBreakdown,
} from '../services/investmentKpiCore';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import { computeCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { buildInvestmentsHeadlineKpiRow } from '../services/extendedMetricsPresentation';
import { describeInvestmentNetInvested } from '../services/investmentCapitalResolve';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const SAR_PER_USD = 3.75;
const PLATFORM_ID = 'platform-mixed-1';

function holding(avgCost: number, qty: number, mark: number, id = 'h1', symbol = '2222.SR'): Holding {
  return {
    id,
    symbol,
    quantity: qty,
    avgCost,
    currentValue: mark * qty,
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    assetClass: 'Stock',
  };
}

function mixedFixture(): {
  financial: FinancialData;
  prices: Record<string, { price: number }>;
  getCash: () => { SAR: number; USD: number };
} {
  const account = {
    id: PLATFORM_ID,
    name: 'Broker',
    type: 'Investment',
    balance: 0,
  } as Account;
  const awaed: InvestmentPortfolio = {
    id: 'pf-awaed',
    name: 'Awaed',
    accountId: PLATFORM_ID,
    currency: 'SAR',
    holdings: [holding(100, 100, 160, 'ha', '2222.SR')],
  };
  const other: InvestmentPortfolio = {
    id: 'pf-other',
    name: 'Other',
    accountId: PLATFORM_ID,
    currency: 'SAR',
    holdings: [holding(200, 200, 250, 'hb', '1120.SR')],
  };
  const financial = {
    accounts: [account],
    personalAccounts: [account],
    investments: [awaed, other],
    personalInvestments: [awaed, other],
    investmentTransactions: [
      {
        id: 'd-awaed',
        type: 'deposit',
        total: 20_000,
        date: '2024-01-01',
        portfolioId: 'pf-awaed',
        accountId: PLATFORM_ID,
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        currency: 'SAR',
      },
    ] as InvestmentTransaction[],
    transactions: [],
    budgets: [],
    goals: [],
    commodityHoldings: [],
    assets: [],
    liabilities: [],
    sukukPositions: [],
  } as unknown as FinancialData;
  return {
    financial,
    prices: { '2222.SR': { price: 160 }, '1120.SR': { price: 250 } },
    getCash: () => ({ SAR: 0, USD: 0 }),
  };
}

describe('hybrid ROI E2E completion across system surfaces', () => {
  it('Dashboard, Investments headline, System Health path, and canonical metrics share mixed net/ROI', () => {
    const { financial, prices, getCash } = mixedFixture();
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(financial, SAR_PER_USD, getCash, prices);
    expect(headline.capitalSource).toBe('mixed');
    expect(headline.netCapitalSar).toBeCloseTo(60_000, 5); // 20k deposits + 40k cost floor
    expect(headline.roi).toBeLessThan(1);

    const breakdown = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCash, prices);
    expect(breakdown.capitalSource).toBe('mixed');
    expect(breakdown.netCapitalSar).toBeCloseTo(headline.platformNetForHeadlineSar, 5);

    const platform = computePlatformCardMetrics({
      portfolios: financial.investments as InvestmentPortfolio[],
      transactions: financial.investmentTransactions as InvestmentTransaction[],
      accounts: financial.accounts as Account[],
      allInvestments: financial.investments as InvestmentPortfolio[],
      sarPerUsd: SAR_PER_USD,
      availableCashByCurrency: { SAR: 0, USD: 0 },
      simulatedPrices: prices,
      platformCurrency: 'SAR',
    });
    expect(platform.capitalSource).toBe('mixed');
    expect(platform.netCapitalSAR).toBeCloseTo(60_000, 5);

    const dash = computeDashboardKpiSnapshot(financial, SAR_PER_USD, getCash, prices);
    expect(dash?.investmentCapitalSource).toBe('mixed');
    expect(dash?.headlineInvestmentExposure?.netCapitalSar).toBeCloseTo(60_000, 5);

    const canonical = computeCanonicalFinancialMetrics({
      data: financial,
      exchangeRate: SAR_PER_USD,
      getAvailableCashForAccount: getCash,
      simulatedPrices: prices,
    });
    const row = buildInvestmentsHeadlineKpiRow(canonical);
    expect(row?.capitalSource).toBe('mixed');
    expect(row?.netInvestedSar).toBeCloseTo(60_000, 5);
    expect(row?.roi).toBeCloseTo(headline.roi * 100, 5);
  });

  it('shared copy helper explains mixed incomplete books', () => {
    expect(describeInvestmentNetInvested('mixed')).toMatch(/hybrid/i);
    expect(describeInvestmentNetInvested('mixed')).toMatch(/cost/i);
  });

  it('wires System Health breakdown with liveQuoteMap + mixed UI copy', () => {
    const health = read('pages/SystemHealth.tsx');
    expect(health).toContain('liveQuoteMap as SimulatedPriceMap');
    expect(health).toContain("capitalSource === 'mixed'");
    expect(health).toContain('hybrid platform net invested');
  });

  it('wires Dashboard + Investments to hybrid definitions', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toContain('describeInvestmentNetInvested');
    expect(dash).toContain("invCapitalSrc === 'mixed'");
    const inv = read('pages/Investments.tsx');
    expect(inv).toContain('describeInvestmentNetInvested');
    expect(inv).toContain('netInvestedSubtitle');
    expect(inv).toContain('headlineNetInvestedDefinition');
    expect(inv).toContain('capitalSource: headlineCapitalSource');
  });

  it('AI grounding + hub meta include capitalSource / hybrid', () => {
    expect(read('services/aiPersonalWealthGrounding.ts')).toContain('hybrid: incomplete portfolios floor');
    expect(read('services/geminiService.ts')).toContain('capitalSource?: string');
    expect(read('services/geminiService.ts')).toContain('hybrid: incomplete portfolios floor at cost + cash');
    expect(read('pages/Investments.tsx')).toContain('capitalSource: headlineCapitalSource');
  });

  it('Netlify gemini-proxy falls back through gemini-3-flash-preview', () => {
    const proxy = read('netlify/functions/gemini-proxy.ts');
    expect(proxy).toContain('GEMINI_MODEL_FALLBACKS');
    expect(proxy).toContain('gemini-3-flash-preview');
    expect(proxy).toContain("FALLBACK_MODEL = 'gemini-3-flash-preview'");
    expect(proxy).toContain('MAX_GEMINI_MODELS_TO_TRY');
    expect(proxy).toContain('isAuthError');
  });

  it('AI surfaces gate on aiActionsEnabled (LiveAdvisor, Watchlist, Commodities, Assets)', () => {
    expect(read('components/LiveAdvisorModal.tsx')).toContain('aiActionsEnabled');
    expect(read('pages/WatchlistView.tsx')).toMatch(/disabled=\{aiTradeLoading \|\| !aiActionsEnabled\}/);
    expect(read('pages/WatchlistView.tsx')).toContain('if (!aiActionsEnabled)');
    expect(read('pages/Commodities.tsx')).toContain('aiActionsEnabled');
    expect(read('pages/Assets.tsx')).toContain('aiActionsEnabled');
  });

  it('version 3.2.1.0 and FEATURES release note', () => {
    expect(read('utils/buildInfo.ts')).toContain("APP_VERSION = '3.2.1.0'");
    expect(read('package.json')).toContain('"version": "3.2.1.0"');
    expect(read('FEATURES.md')).toContain('3.2.1.0');
  });
});
