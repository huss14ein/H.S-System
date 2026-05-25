import { describe, it, expect } from 'vitest';
import { buildHeadlineInvestmentAllocationSlices } from '../services/headlineInvestmentAllocation';
import { computeHeadlinePersonalInvestmentRoiDecimal } from '../services/investmentKpiCore';
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
  });
});
