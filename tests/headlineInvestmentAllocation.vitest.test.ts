import { describe, it, expect } from 'vitest';
import { buildHeadlineInvestmentAllocationSlices } from '../services/headlineInvestmentAllocation';
import { computeHeadlinePersonalInvestmentRoiDecimal } from '../services/investmentKpiCore';
import {
  buildCanonicalFinancialMetricsResult,
  buildFastCanonicalFinancialMetricsResult,
  overlayLiveQuoteTierOntoExtendedMetrics,
} from '../hooks/canonicalFinancialMetricsBundle';
import type { FinancialData } from '../types';

describe('buildHeadlineInvestmentAllocationSlices', () => {
  it('scales portfolio and asset-class rows to headline totalExposureSar', () => {
    const data = {
      accounts: [{ id: 'inv', name: 'Broker', type: 'Investment', balance: 1000, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'Growth',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [
            { symbol: '2222', name: 'SABIC', quantity: 10, avgCost: 80, currentValue: 900, assetClass: 'Equity' },
          ],
        },
        {
          id: 'pf2',
          name: 'Income',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [
            { symbol: '1120', name: 'Rajhi', quantity: 5, avgCost: 90, currentValue: 500, assetClass: 'Equity' },
          ],
        },
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = () => ({ SAR: 500, USD: 0 });
    const prices = { '2222': { price: 95 }, '1120': { price: 92 } };
    const exposure = computeHeadlinePersonalInvestmentRoiDecimal(data, fx, getCash, prices);
    const investableCash = 500;
    const slices = buildHeadlineInvestmentAllocationSlices(data, exposure, fx, investableCash, prices);

    expect(slices.totalSar).toBe(exposure.totalExposureSar);
    const portfolioSum = slices.portfolioAllocation.reduce((s, r) => s + r.value, 0);
    const assetSum = slices.assetClassAllocation.reduce((s, r) => s + r.value, 0);
    expect(portfolioSum).toBeCloseTo(exposure.totalExposureSar, 0);
    expect(assetSum).toBeCloseTo(exposure.totalExposureSar, 0);
    const stockRow = slices.assetClassAllocation.find((r) => r.name === 'Stock');
    expect(stockRow).toBeTruthy();
    expect(stockRow!.value).toBeGreaterThan(0);
  });

  it('maps Equity holdings into the Stock asset-class bucket', () => {
    const data = {
      accounts: [{ id: 'inv', name: 'Broker', type: 'Investment', balance: 0, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'Growth',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [
            { symbol: '2222', name: 'Aramco', quantity: 10, avgCost: 30, currentValue: 300, assetClass: 'Equity' },
          ],
        },
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const exposure = {
      totalExposureSar: 300,
      platformsRollupSar: 300,
      commoditiesValueSar: 0,
      sukukPositionsValueSar: 0,
    };
    const slices = buildHeadlineInvestmentAllocationSlices(data, exposure, 3.75, 0, {});
    expect(slices.assetClassAllocation.map((r) => r.name)).toContain('Stock');
    expect(slices.assetClassAllocation.map((r) => r.name)).not.toContain('Equity');
  });
});

describe('overlayLiveQuoteTierOntoExtendedMetrics allocation rebuild', () => {
  it('surfaces Stock rows when live quotes mark equities that had zero stored value', () => {
    const data = {
      accounts: [{ id: 'inv', name: 'Broker', type: 'Investment', balance: 43875, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [
        {
          id: 'c1',
          symbol: 'XAU',
          name: 'Gold',
          quantity: 1,
          unit: 'oz',
          purchaseValue: 10000,
          currentValue: 11625.3,
          zakahClass: 'Zakatable',
        },
      ],
      investments: [
        {
          id: 'pf1',
          name: 'Growth',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [
            {
              id: 'h-stock',
              symbol: '2222',
              name: 'Aramco',
              quantity: 100,
              avgCost: 0,
              currentValue: 0,
              assetClass: 'Stock',
              zakahClass: 'Zakatable',
              realizedPnL: 0,
            },
          ],
        },
      ],
      sukukPositions: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 43875, USD: 0 } : { SAR: 0, USD: 0 });
    const baseArgs = {
      data,
      exchangeRate: 3.75,
      getAvailableCashForAccount: getCash,
      showHydrateBanner: false as const,
    };
    const extended = buildCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: {},
    });
    expect(extended.investmentAllocation.assetClassAllocation.some((r) => r.name === 'Stock')).toBe(false);

    const live = buildFastCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: { '2222': { price: 30, change: 0.2, changePercent: 0.67 } },
    });
    const merged = overlayLiveQuoteTierOntoExtendedMetrics(extended, live);
    const stockRow = merged.investmentAllocation.assetClassAllocation.find((r) => r.name === 'Stock');
    expect(stockRow).toBeTruthy();
    expect(stockRow!.value).toBeGreaterThan(0);
    expect(merged.investmentAllocation.totalSar).toBe(merged.investmentsTotalSar);
  });
});
