import { describe, it, expect } from 'vitest';
import { computeCanonicalFinancialMetrics, buildFastCanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import { overlayLiveQuoteTierOntoExtendedMetrics, buildFastCanonicalFinancialMetricsResult, buildCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';
import type { FinancialData } from '../types';

describe('computeCanonicalFinancialMetrics', () => {
  it('aligns headline, KPI, today snapshot, and investable cash total', () => {
    const data = {
      accounts: [
        { id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' },
        { id: 'inv', name: 'Broker', type: 'Investment', balance: 2000, currency: 'SAR' },
      ],
      assets: [{ id: 'p1', name: 'Gold', type: 'Physical', value: 3000 }],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'PF',
          accountId: 'inv',
          currency: 'SAR',
          holdings: [{ symbol: '2222', name: 'SABIC', quantity: 10, avgCost: 80, currentValue: 900 }],
        },
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = (id: string) => (id === 'inv' ? { SAR: 2000, USD: 0 } : { SAR: 0, USD: 0 });
    const prices = { '2222': { price: 95 } };
    const m = computeCanonicalFinancialMetrics({
      data,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: prices,
    });

    expect(m.kpiSnapshot?.netWorth).toBe(m.netWorth);
    expect(m.todaySnapshot.netWorth).toBe(m.netWorth);
    expect(m.wealthSummary?.financialMetricsWithEf.netWorth).toBe(m.netWorth);
    expect(m.investableCashTotalSar).toBeCloseTo(
      m.investableCashBars.reduce((s, b) => s + b.sar, 0),
      6,
    );
    expect(m.liquidCashSar).toBe(m.kpiSnapshot?.liquidCashSar);
    expect(m.investmentsTotalSar).toBe(m.headline.buckets.investments);
    expect(m.todaySnapshot.investmentsSar).toBe(m.investmentsTotalSar);
    if (m.investmentExposure) {
      expect(m.investmentExposure.totalExposureSar).toBe(m.investmentsTotalSar);
    }
    const allocSum = m.investmentAllocation.portfolioAllocation.reduce((s, r) => s + r.value, 0);
    expect(allocSum).toBeCloseTo(m.investmentsTotalSar, 0);
  });

  it('investments bucket includes commodities and matches Investments hub exposure', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 1000, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [{ id: 'c1', name: 'Gold', quantity: 1, currentValue: 5000, purchaseValue: 4000 }],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = () => ({ SAR: 0, USD: 0 });
    const m = computeCanonicalFinancialMetrics({
      data,
      exchangeRate: fx,
      getAvailableCashForAccount: getCash,
      simulatedPrices: {},
    });
    expect(m.investmentsTotalSar).toBeGreaterThan(0);
    expect(m.investmentsTotalSar).toBe(m.investmentExposure!.totalExposureSar);
    expect(m.investmentsTotalSar).toBe(m.headline.buckets.investments);
  });

  it('derives commodities and Sukuk slices when getAvailableCashForAccount is missing', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 1000, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [{ id: 'c1', name: 'Gold', quantity: 1, currentValue: 5000, purchaseValue: 4000 }],
      sukukPositions: [
        {
          id: 's1',
          name: 'Sukuk',
          investmentAccountId: 'a1',
          currency: 'SAR',
          faceValue: 2000,
          outstandingPrincipal: 2000,
          issueDate: '2024-01-01',
          maturityDate: '2027-01-01',
          status: 'active',
        },
      ],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const m = computeCanonicalFinancialMetrics({
      data,
      exchangeRate: 3.75,
      simulatedPrices: {},
    });
    expect(m.investmentExposure).toBeNull();
    expect(m.investmentsTotalSar).toBe(m.headline.buckets.investments);
    expect(m.headlineExposureParts.commoditiesValueSar).toBe(5000);
    expect(m.headlineExposureParts.sukukPositionsValueSar).toBe(2000);
    expect(
      m.headlineExposureParts.platformsRollupSar +
        m.headlineExposureParts.commoditiesValueSar +
        m.headlineExposureParts.sukukPositionsValueSar,
    ).toBeCloseTo(m.investmentsTotalSar, 6);
    expect(m.investmentAllocation.commoditiesSar).toBe(5000);
  });

  it('fast phase exposes headline + KPI without wealth summary (extended phase fills later)', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fast = buildFastCanonicalFinancialMetrics({
      data,
      exchangeRate: 3.75,
      getAvailableCashForAccount: () => ({ SAR: 0, USD: 0 }),
      simulatedPrices: {},
    });
    expect(fast.netWorth).toBeGreaterThan(0);
    expect(fast.kpiSnapshot?.netWorth).toBe(fast.netWorth);
    expect(fast.wealthSummary).toBeNull();
    expect(fast.investmentAllocation.portfolioAllocation).toEqual([]);
    expect(fast.investmentExposure).not.toBeNull();
    expect(fast.investmentExposure!.roi).toBe(fast.kpiSnapshot?.roi);
  });

  it('overlayLiveQuoteTierOntoExtendedMetrics replaces stale quote-driven fields', () => {
    const data = {
      accounts: [{ id: 'a1', name: 'Chk', type: 'Checking', balance: 5000, currency: 'SAR' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'PF',
          accountId: 'a1',
          currency: 'SAR',
          holdings: [{ symbol: 'AAPL', name: 'Apple', quantity: 10, avgCost: 100, currentValue: 1000 }],
        },
      ],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const getCash = () => ({ SAR: 0, USD: 0 });
    const baseArgs = {
      data,
      exchangeRate: 3.75,
      getAvailableCashForAccount: getCash,
      showHydrateBanner: false as const,
    };
    const extended = buildCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: { AAPL: { price: 100, change: 0, changePercent: 0 } },
    });
    const live = buildFastCanonicalFinancialMetricsResult({
      ...baseArgs,
      debouncedPrices: { AAPL: { price: 120, change: 2, changePercent: 2 } },
    });
    const merged = overlayLiveQuoteTierOntoExtendedMetrics(extended, live);
    expect(merged.simulatedPrices.AAPL?.price).toBe(120);
    expect(merged.investmentsTotalSar).toBe(live.investmentsTotalSar);
    expect(merged.netWorth).toBe(live.netWorth);
    expect(merged.wealthSummary).toBe(extended.wealthSummary);
    expect(merged.metricsExtendedReady).toBe(true);
    expect(merged.investmentExposure).not.toBeNull();
    expect(merged.investmentExposure!.totalGainLossSar).toBe(live.investmentExposure!.totalGainLossSar);
    expect(merged.investmentExposure!.roi).toBe(live.investmentExposure!.roi);
    expect(merged.investmentsTotalSar).toBe(merged.investmentExposure!.totalExposureSar);
    expect(merged.investmentAllocation.portfolioAllocation.length).toBeGreaterThan(0);
    expect(merged.investmentAllocation.totalSar).toBe(merged.investmentsTotalSar);
  });
});
