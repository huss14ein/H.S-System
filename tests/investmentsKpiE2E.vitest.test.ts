/**
 * Investments headline KPIs — single rollup path end to end (gain/loss, ROI, daily P/L, total value).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import {
  buildInvestmentsHeadlineKpiRow,
  headlineKpiMathIsConsistent,
  pickHeadlineInvestmentExposure,
} from '../services/extendedMetricsPresentation';
import {
  buildCanonicalFinancialMetricsResult,
  buildFastCanonicalFinancialMetricsResult,
  overlayLiveQuoteTierOntoExtendedMetrics,
} from '../hooks/canonicalFinancialMetricsBundle';
import { pickDashboardRoiDecimal } from '../services/extendedMetricsPresentation';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const portfolioData = {
  accounts: [
    { id: 'chk', name: 'Checking', type: 'Checking', balance: 10000, currency: 'SAR' },
    { id: 'inv', name: 'Broker', type: 'Investment', balance: 0, currency: 'SAR' },
  ],
  assets: [],
  sukukPositions: [
    {
      id: 's1',
      name: 'Sukuk',
      investmentAccountId: 'inv',
      currency: 'SAR',
      faceValue: 3000,
      outstandingPrincipal: 3000,
      issueDate: '2024-01-01',
      maturityDate: '2027-01-01',
      status: 'active',
    },
  ],
  liabilities: [],
  commodityHoldings: [{ id: 'c1', name: 'Gold', quantity: 2, currentValue: 8000, purchaseValue: 7000 }],
  investments: [
    {
      id: 'pf1',
      name: 'PF',
      accountId: 'inv',
      currency: 'SAR',
      holdings: [{ symbol: '2222', name: 'SABIC', quantity: 100, avgCost: 80, currentValue: 9000 }],
    },
  ],
  transactions: [],
  budgets: [],
} as unknown as FinancialData;

describe('Investments headline KPI E2E', () => {
  it('Investments page uses single buildInvestmentsHeadlineKpiRow source', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('buildInvestmentsHeadlineKpiRow(metrics)');
    expect(page).not.toContain('headlineExposure?.totalGainLossSar');
    expect(page).toContain('headlineKpisReady');
  });

  it('canonical metrics: exposure drives KPI row with consistent gain/loss and ROI', () => {
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 1500, USD: 0 } : { SAR: 0, USD: 0 });
    const prices = { '2222': { price: 95, change: 1.5, changePercent: 1.6 } };
    const m = computeCanonicalFinancialMetrics({
      data: portfolioData,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: prices,
    });
    const exposure = pickHeadlineInvestmentExposure(m);
    expect(exposure).not.toBeNull();
    expect(headlineKpiMathIsConsistent(exposure!)).toBe(true);

    const row = buildInvestmentsHeadlineKpiRow(m);
    expect(row).not.toBeNull();
    expect(row!.totalValue).toBe(exposure!.totalExposureSar);
    expect(row!.totalValue).toBe(m.investmentsTotalSar);
    expect(row!.totalGainLoss).toBe(exposure!.totalGainLossSar);
    expect(row!.roi).toBeCloseTo(exposure!.roi * 100, 6);
    expect(row!.totalDailyPnL).toBeCloseTo(
      exposure!.platformsDailyPnLSar + exposure!.commoditiesDailyPnLSar,
      6,
    );
    expect(row!.platformsRollupSAR + row!.commoditiesValueSAR + row!.sukukPositionsValueSAR).toBeCloseTo(
      row!.totalValue,
      0,
    );
  });

  it('overlay: live quote tier keeps investmentsTotalSar aligned with investmentExposure', () => {
    const getCash = (id: string) => (id === 'inv' ? { SAR: 1500, USD: 0 } : { SAR: 0, USD: 0 });
    const baseArgs = {
      data: portfolioData,
      exchangeRate: 3.75,
      getAvailableCashForAccount: getCash,
      showHydrateBanner: false as const,
    };
    const extended = buildCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: { '2222': { price: 90, change: 0, changePercent: 0 } },
    });
    const live = buildFastCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: { '2222': { price: 100, change: 2, changePercent: 2.2 } },
    });
    const merged = overlayLiveQuoteTierOntoExtendedMetrics(extended, live);
    const exposure = merged.investmentExposure;
    expect(exposure).not.toBeNull();
    expect(merged.investmentsTotalSar).toBe(exposure!.totalExposureSar);
    expect(merged.investmentsTotalSar).toBe(live.investmentsTotalSar);

    const row = buildInvestmentsHeadlineKpiRow(merged);
    expect(row).not.toBeNull();
    expect(row!.totalGainLoss).toBe(exposure!.totalGainLossSar);
    expect(row!.roi).toBeCloseTo(exposure!.roi * 100, 6);
    expect(headlineKpiMathIsConsistent(exposure!)).toBe(true);
  });

  it('KPI debounce stays responsive for quote-driven recomputes', () => {
    const ctx = read('context/CanonicalFinancialMetricsContext.tsx');
    expect(ctx).toMatch(/useDebouncedValue\(simulatedPrices,\s*250\)/);
  });

  it('useCanonicalSimulatedPrices reads KPI quote map from shell provider', () => {
    const hook = read('hooks/useCanonicalFinancialMetrics.ts');
    expect(hook).toContain('shell.full.simulatedPrices');
    expect(hook).toContain('useDebouncedValue(simulatedPrices, 250)');
    expect(hook).not.toMatch(/useCanonicalSimulatedPrices[\s\S]{0,120}useMarketPrices\(\)\.simulatedPrices/);
  });

  it('Investments platform cards use canonical KPI quotes for rollup metrics', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('kpiQuotePrices');
    expect(page).toContain('simulatedPrices: kpiQuotePrices');
  });

  it('Investments metrics context exposes liveQuotePrices without overriding KPI map', () => {
    const ctx = read('context/InvestmentsMetricsContext.tsx');
    expect(ctx).toContain('liveQuotePrices');
    expect(ctx).not.toContain('return { ...metrics, simulatedPrices }');
  });

  it('InvestmentOverview weights use canonical metrics simulatedPrices', () => {
    const page = read('pages/InvestmentOverview.tsx');
    expect(page).toContain('effectiveHoldingValueInBookCurrency');
    expect(page).toContain('simulatedPrices');
    expect(page).not.toContain('useLiveQuotePrices');
  });

  it('ExecutiveStatusRow uses headline exposure picker', () => {
    expect(read('components/dashboard/ExecutiveStatusRow.tsx')).toContain('pickHeadlineInvestmentsExposureSar');
  });

  it('Summary ROI uses kpiSnapshot only (no ad-hoc recompute fallback)', () => {
    const page = read('pages/Summary.tsx');
    expect(page).toContain('kpiSnapshot.budgetVariance');
    expect(page).not.toContain('computeMonthlyReportFinancialKpis');
  });

  it('fast tier exposes headline KPIs before extendedReady', () => {
    const data = portfolioData;
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 1500, USD: 0 } : { SAR: 0, USD: 0 });
    const fast = buildFastCanonicalFinancialMetricsResult({
      data,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      debouncedPrices: { '2222': { price: 95, change: 1, changePercent: 1 } },
      showHydrateBanner: false,
    });
    expect(fast.metricsExtendedReady).toBe(false);
    expect(buildInvestmentsHeadlineKpiRow(fast)).not.toBeNull();
    expect(fast.kpiSnapshot?.headlineInvestmentExposure?.totalGainLossSar).toBe(
      buildInvestmentsHeadlineKpiRow(fast)!.totalGainLoss,
    );
  });

  it('pickDashboardRoiDecimal matches exposure rollup', () => {
    const m = computeCanonicalFinancialMetrics({
      data: portfolioData,
      exchangeRate: 3.75,
      getAvailableCashForAccount: (id: string) => (id === 'inv' ? { SAR: 1500, USD: 0 } : { SAR: 0, USD: 0 }),
      simulatedPrices: { '2222': { price: 95 } },
    });
    const exposure = pickHeadlineInvestmentExposure(m);
    expect(pickDashboardRoiDecimal(m)).toBe(exposure?.roi);
    expect((pickDashboardRoiDecimal(m) ?? 0) * 100).toBeCloseTo(buildInvestmentsHeadlineKpiRow(m)!.roi, 6);
  });
});
