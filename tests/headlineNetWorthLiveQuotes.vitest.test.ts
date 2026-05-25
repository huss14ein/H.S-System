import { describe, expect, it } from 'vitest';
import { computePersonalHeadlineNetWorthSar } from '../services/personalNetWorth';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { computeWealthSummaryReportModel } from '../services/wealthSummaryReportModel';
import type { FinancialData } from '../types';

describe('headline net worth live quotes alignment', () => {
  const fx = 3.75;
  const getCash = () => ({ SAR: 0, USD: 0 });

  const data = {
    accounts: [
      { id: 'inv1', name: 'Broker', type: 'Investment', balance: 0, currency: 'USD' },
    ],
    assets: [],
    liabilities: [],
    commodityHoldings: [],
    investments: [
      {
        id: 'p1',
        accountId: 'inv1',
        currency: 'USD',
        holdings: [
          {
            symbol: 'AAPL',
            quantity: 10,
            avgCost: 100,
            currentValue: 1000,
            holdingType: 'ticker',
          },
        ],
      },
    ],
    transactions: [],
    budgets: [],
  } as unknown as FinancialData;

  const livePrices = { AAPL: { price: 200 } };

  it('uses live quotes for headline NW when simulatedPrices are provided', () => {
    const stored = computePersonalHeadlineNetWorthSar(data, fx, {
      getAvailableCashForAccount: getCash,
      simulatedPrices: {},
    });
    const live = computePersonalHeadlineNetWorthSar(data, fx, {
      getAvailableCashForAccount: getCash,
      simulatedPrices: livePrices,
    });
    expect(live.netWorth).toBeGreaterThan(stored.netWorth);
    expect(live.netWorth - stored.netWorth).toBeCloseTo(10 * 100 * fx, 0);
  });

  it('Dashboard KPI and Wealth Summary share the same headline net worth', () => {
    const dash = computeDashboardKpiSnapshot(data, fx, getCash, livePrices);
    const summary = computeWealthSummaryReportModel(data, fx, getCash, livePrices);
    expect(dash?.netWorth).toBe(summary.financialMetricsWithEf.netWorth);
  });
});
