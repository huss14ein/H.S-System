/**
 * System-wide E2E — portfolio sync, live quotes, canonical KPIs, period P/L across all surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { computePlatformCardMetrics } from '../services/investmentPlatformCardMetrics';
import { buildInvestmentsHeadlineKpiRow } from '../services/extendedMetricsPresentation';
import { computeCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import type { FinancialData, InvestmentPortfolio } from '../types';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listTsx(rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

/** Strip block/line comments so wiring scans ignore documentation examples. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('system-wide quote + KPI E2E', () => {
  it('no UI surface calls refreshPricesForPlatform or uses raw simulatedPrices[sym] bracket lookup', () => {
    const offenders: string[] = [];
    for (const file of listTsx('pages').concat(listTsx('components'))) {
      const src = stripComments(read(file));
      if (src.includes('refreshPricesForPlatform(')) offenders.push(`${file}: refreshPricesForPlatform`);
      if (/simulatedPrices\[[^\]]+\]/.test(src)) offenders.push(`${file}: simulatedPrices[...]`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('wealth pages use canonical or live quote hooks (no ad-hoc NW recompute)', () => {
    const exempt = new Set([
      'pages/LoginPage.tsx',
      'pages/SignupPage.tsx',
      'pages/PendingApprovalPage.tsx',
      'pages/SystemHealth.tsx',
      'pages/Installments.tsx',
      'pages/StatementHistoryView.tsx',
      'pages/ExecutionHistoryView.tsx',
      'pages/FinancialJournal.tsx',
      'pages/SinkingFunds.tsx',
      'pages/Notifications.tsx',
      'pages/Cashflow.tsx',
      'pages/Platforms.tsx',
      'pages/TransactionsPage.tsx',
    ]);
    const hooks = [
      'useCanonicalFinancialMetrics',
      'useDashboardCanonicalMetrics',
      'useInvestmentsCanonicalMetrics',
      'useExtendedCanonicalMetrics',
      'useCanonicalSpotFx',
      'useEmergencyFund',
    ];
    const missing: string[] = [];
    for (const file of listTsx('pages')) {
      if (exempt.has(file)) continue;
      const src = read(file);
      if (!hooks.some((h) => src.includes(h))) missing.push(file);
    }
    expect(missing, `Add canonical hook to: ${missing.join(', ')}`).toEqual([]);
  });

  it('investment sub-views: KPI map for planning, liveQuotePrices for spot/holdings', () => {
    for (const file of [
      'pages/AIRebalancerView.tsx',
      'pages/InvestmentPlanView.tsx',
      'pages/RecoveryPlanView.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('useInvestmentsCanonicalMetrics');
      expect(src).toContain('liveQuotePrices');
      expect(src).toContain('computeCanonicalPlanningSnapshot');
    }
  });

  it('period P/L wired on Investments, Dashboard panel, Wealth Analytics export model', () => {
    expect(read('pages/Investments.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('components/dashboard/PortfolioPeriodPnLPanel.tsx')).toContain('usePortfolioPeriodPnLSnapshot');
    expect(read('pages/WealthAnalytics.tsx')).toContain('useLiveQuotePrices');
    expect(read('services/wealthAnalyticsReportModel.ts')).toContain('computePortfolioPeriodPnLSummary');
    expect(read('services/portfolioPeriodPnL.ts')).toContain('useLiveMark: false');
  });

  it('alias-aware valuation: bare Tadawul ticker resolves via .SR quote map', () => {
    const h = {
      symbol: 'REITF',
      quantity: 100,
      avgCost: 10,
      currentValue: 0,
      holdingType: 'ticker' as const,
    };
    const prices = { 'REITF.SR': { price: 12, change: 0, changePercent: 0 } };
    expect(effectiveHoldingValueInBookCurrency(h, 'SAR', prices, 3.75)).toBe(1200);
  });

  it('headline KPI row matches platform rollup when using the same KPI quote map', () => {
    const portfolios: InvestmentPortfolio[] = [
      {
        id: 'p1',
        name: 'Tadawul',
        accountId: 'inv',
        currency: 'SAR',
        holdings: [
          {
            id: 'h1',
            symbol: '2222.SR',
            quantity: 50,
            avgCost: 30,
            currentValue: 1500,
            holdingType: 'ticker',
          } as any,
        ],
      },
    ];
    const data = {
      accounts: [{ id: 'inv', name: 'Broker', type: 'Investment', balance: 0, currency: 'SAR' }],
      investments: portfolios,
      personalInvestments: portfolios,
      investmentTransactions: [],
      commodityHoldings: [],
      sukukPositions: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 500, USD: 0 } : { SAR: 0, USD: 0 });
    const kpiPrices = { '2222.SR': { price: 32, change: 0.5, changePercent: 1 } };

    const metrics = computeCanonicalFinancialMetrics({
      data,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: kpiPrices,
    });
    const headline = buildInvestmentsHeadlineKpiRow(metrics);
    expect(headline).not.toBeNull();

    const platform = computePlatformCardMetrics({
      portfolios,
      transactions: [],
      accounts: data.accounts!,
      allInvestments: portfolios,
      sarPerUsd: fx,
      availableCashByCurrency: { SAR: 500, USD: 0 },
      simulatedPrices: kpiPrices,
      dailyPnLPrices: kpiPrices,
      platformCurrency: 'SAR',
    });

    expect(platform.holdingsValueInSAR).toBeCloseTo(1600, 0);
    expect(headline!.platformsRollupSAR).toBeCloseTo(platform.totalValueInSAR, 0);
  });

  it('verification script registers system-wide quote KPI E2E test', () => {
    expect(read('scripts/verify-performance-recovery.mjs')).toContain('systemWideQuoteKpiE2E.vitest.test.ts');
  });
});
