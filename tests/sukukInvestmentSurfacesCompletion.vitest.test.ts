/**
 * Direct Sukuk in all investment KPI / page / calc surfaces — completion wiring.
 * Canonical path: sumPersonalSukukPositionsSar → computeHeadlinePersonalInvestmentRoiDecimal → investmentsTotalSar.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sumPersonalSukukPositionsSar } from '../services/sukuk/sukukExposure';
import { computeHeadlinePersonalInvestmentRoiDecimal } from '../services/investmentKpiCore';
import { summarizeZakatableSukukPositionsForZakat } from '../services/zakatInvestmentValuation';
import type { FinancialData } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const emptyData = (overrides: Partial<FinancialData> = {}): FinancialData =>
  ({
    accounts: [],
    assets: [],
    goals: [],
    liabilities: [],
    budgets: [],
    investments: [],
    investmentTransactions: [],
    transactions: [],
    commodities: [],
    commodityHoldings: [],
    sukukPositions: [],
    ...overrides,
  }) as FinancialData;

describe('sukukInvestmentSurfacesCompletion', () => {
  const surfaces: { path: string; patterns: string[] }[] = [
    {
      path: 'services/investmentKpiCore.ts',
      patterns: ['sumPersonalSukukPositionsSar', 'sukukPositionsValueSar', 'totalExposureSar'],
    },
    {
      path: 'services/personalNetWorth.ts',
      patterns: ['computeHeadlinePersonalInvestmentRoiDecimal', 'totalExposureSar'],
    },
    {
      path: 'services/dashboardKpiSnapshot.ts',
      patterns: ['computeHeadlinePersonalInvestmentRoiDecimal'],
    },
    {
      path: 'services/wealthSummaryReportModel.ts',
      patterns: ['computeHeadlinePersonalInvestmentRoiDecimal', 'totalExposureSar'],
    },
    {
      path: 'services/canonicalFinancialMetrics.ts',
      patterns: ['sumPersonalSukukPositionsSar', 'sukukPositionsValueSar'],
    },
    {
      path: 'services/liquidNetWorth.ts',
      patterns: ['sumPersonalSukukPositionsSar'],
    },
    {
      path: 'services/weeklyDigestNetWorthSar.ts',
      patterns: ['computePersonalHeadlineNetWorthSar'],
    },
    {
      path: 'services/extendedMetricsPresentation.ts',
      patterns: ['pickInvestmentsTotalSar', 'pickSukukPositionsValueSar'],
    },
    {
      path: 'pages/Investments.tsx',
      patterns: ['buildInvestmentsHeadlineKpiRow', 'SukukInvestmentsSection', 'sukukPositionsValueSAR'],
    },
    {
      path: 'pages/InvestmentOverview.tsx',
      patterns: ['investmentsTotalSar', 'useExtendedCanonicalMetrics'],
    },
    {
      path: 'pages/Dashboard.tsx',
      patterns: ['useDashboardCanonicalMetrics', 'Investment ROI', 'commodities + Sukuk'],
    },
    {
      path: 'pages/Summary.tsx',
      patterns: ['useExtendedCanonicalMetrics'],
    },
    {
      path: 'pages/Accounts.tsx',
      patterns: ['pickInvestmentsTotalSar'],
    },
    {
      path: 'pages/Analysis.tsx',
      patterns: ['pickInvestmentsTotalSar'],
    },
    {
      path: 'pages/Forecast.tsx',
      patterns: ['pickInvestmentsTotalSar', 'platforms + commodities + direct Sukuk'],
    },
    {
      path: 'pages/WealthUltraDashboard.tsx',
      patterns: ['pickInvestmentsTotalSar', 'Platform equity (USD)'],
    },
    {
      path: 'pages/Zakat.tsx',
      patterns: ['summarizeZakatableSukukPositionsForZakat', 'invValue + sukukValue', 'sukukLines'],
    },
    {
      path: 'pages/Commodities.tsx',
      patterns: ['pickInvestmentsTotalSar'],
    },
    {
      path: 'components/analytics/zones/WealthZone.tsx',
      patterns: ['sumPersonalSukukPositionsSar'],
    },
    {
      path: 'services/investmentEngine/universe.ts',
      patterns: ['sumPersonalSukukPositionsSar', 'toSAR(outstanding'],
    },
    {
      path: 'services/zakatTradeAdvisor.ts',
      patterns: ['summarizeZakatableSukukPositionsForZakat'],
    },
  ];

  it.each(surfaces)('wires Sukuk/canonical path in $path', ({ path, patterns }) => {
    const src = read(path);
    for (const p of patterns) {
      expect(src, `${path} missing: ${p}`).toContain(p);
    }
  });

  it('headline ROI totalExposureSar = platforms + commodities + direct Sukuk', () => {
    const data = emptyData({
      sukukPositions: [
        {
          id: 'sk1',
          name: 'Gov',
          investmentAccountId: 'a1',
          currency: 'USD',
          faceValue: 1000,
          outstandingPrincipal: 1000,
          issueDate: '2020-01-01',
          maturityDate: '2030-01-01',
          status: 'active',
        },
      ],
      accounts: [
        {
          id: 'a1',
          name: 'Inv',
          type: 'Investment',
          balance: 0,
          currency: 'USD',
        } as any,
      ],
    });
    const sukuk = sumPersonalSukukPositionsSar(data, 3.75);
    expect(sukuk).toBeCloseTo(3750, 0);
    const getCash = () => ({ SAR: 0, USD: 0 });
    const roi = computeHeadlinePersonalInvestmentRoiDecimal(data, 3.75, getCash, {});
    expect(roi.sukukPositionsValueSar).toBeCloseTo(3750, 0);
    expect(roi.totalExposureSar).toBeGreaterThanOrEqual(roi.sukukPositionsValueSar - 0.01);
  });

  it('Zakat counts direct Sukuk with USD FX after hawl', () => {
    const data = emptyData({
      sukukPositions: [
        {
          id: 'sk1',
          name: 'Gov',
          investmentAccountId: 'a1',
          currency: 'USD',
          faceValue: 2000,
          outstandingPrincipal: 2000,
          issueDate: '2020-01-01',
          maturityDate: '2030-01-01',
          status: 'active',
        },
      ],
    });
    const { totalSar, lines } = summarizeZakatableSukukPositionsForZakat(
      data,
      3.75,
      new Date('2026-07-15T12:00:00.000Z'),
    );
    expect(lines).toHaveLength(1);
    expect(totalSar).toBeCloseTo(7500, 0);
  });
});
