import { describe, expect, it } from 'vitest';
import {
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
  computePersonalNetWorthChartBucketsSAR,
  computePersonalNetWorthSAR,
} from '../services/personalNetWorth';
import { resolveSarPerUsd } from '../utils/currencyMath';

describe('personalNetWorth', () => {
  it('returns zero breakdown on null data', () => {
    expect(computePersonalNetWorthBreakdownSAR(null, 3.75)).toEqual({
      totalAssets: 0,
      totalDebt: 0,
      totalReceivable: 0,
      netWorth: 0,
    });
    expect(computePersonalNetWorthSAR(null, 3.75)).toBe(0);
  });

  it('counts linked credit card debt once (liability only, not mirrored account)', () => {
    const data: any = {
      accounts: [{ id: 'cc1', type: 'Credit', balance: -500, currency: 'SAR' }],
      liabilities: [{ type: 'Credit Card', amount: -500, status: 'Active', accountId: 'cc1' }],
      assets: [],
      commodityHoldings: [],
      investments: [],
    };
    const breakdown = computePersonalNetWorthBreakdownSAR(data, 3.75);
    expect(breakdown.totalDebt).toBe(500);
  });

  it('computes assets, debt, receivable, and net worth consistently', () => {
    const data: any = {
      accounts: [
        { type: 'Checking', balance: 1000 },
        { type: 'Savings', balance: -200 },
        { type: 'Credit', balance: -300 },
      ],
      assets: [{ value: 5000 }],
      liabilities: [{ amount: -400 }, { amount: 250 }],
      commodityHoldings: [{ currentValue: 600 }],
      investments: [],
    };

    const breakdown = computePersonalNetWorthBreakdownSAR(data, 3.75);
    expect(breakdown.totalAssets).toBe(6600);
    expect(breakdown.totalDebt).toBe(900);
    expect(breakdown.totalReceivable).toBe(250);
    expect(breakdown.netWorth).toBe(5950);
    expect(computePersonalNetWorthSAR(data, 3.75)).toBe(5950);
  });

  it('includes investment-account ledger cash when getAvailableCashForAccount is provided', () => {
    const data: any = {
      accounts: [
        { id: 'inv1', type: 'Investment', balance: 0 },
        { type: 'Checking', balance: 0 },
      ],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [],
    };
    const getAvailableCashForAccount = () => ({ SAR: 4000, USD: 0 });
    const b = computePersonalNetWorthBreakdownSAR(data, 3.75, { getAvailableCashForAccount });
    expect(b.totalAssets).toBe(4000);
    expect(b.netWorth).toBe(4000);
  });

  it('chart buckets sum to the same net worth as the breakdown', () => {
    const data: any = {
      accounts: [
        { type: 'Checking', balance: 1000 },
        { type: 'Savings', balance: -200 },
        { type: 'Credit', balance: -300 },
      ],
      assets: [{ value: 5000 }],
      liabilities: [{ amount: -400 }, { amount: 250 }],
      commodityHoldings: [{ currentValue: 600 }],
      investments: [],
    };
    const breakdown = computePersonalNetWorthBreakdownSAR(data, 3.75);
    const buckets = computePersonalNetWorthChartBucketsSAR(data, 3.75);
    expect(buckets.cash + buckets.investments + buckets.physicalAndCommodities + buckets.receivables + buckets.liabilities).toBe(
      breakdown.netWorth
    );
    expect(buckets.netWorth).toBe(breakdown.netWorth);
  });

  it('breakdown uses resolved FX when wealth config overrides UI rate', () => {
    const data: any = {
      wealthUltraConfig: { fxRate: 4 },
      accounts: [{ id: 'inv', type: 'Investment', balance: 0, currency: 'USD' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'PF',
          accountId: 'inv',
          currency: 'USD',
          holdings: [{ symbol: 'AAPL', name: 'AAPL', quantity: 1, avgCost: 100, currentValue: 100 }],
        },
      ],
    };
    const uiFx = 3.75;
    const getAvailableCashForAccount = () => ({ SAR: 0, USD: 0 });
    const opts = { getAvailableCashForAccount, simulatedPrices: {} as Record<string, { price: number }> };
    const headline = computePersonalHeadlineNetWorthSar(data, uiFx, opts);
    const breakdown = computePersonalNetWorthBreakdownSAR(data, uiFx, opts);
    expect(headline.sarPerUsd).toBe(4);
    expect(breakdown.netWorth).toBe(headline.netWorth);
  });

  it('headline investment bucket uses resolved FX, not raw UI rate when wealth config overrides', () => {
    const data: any = {
      wealthUltraConfig: { fxRate: 4 },
      accounts: [{ id: 'inv', type: 'Investment', balance: 0, currency: 'USD' }],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [
        {
          id: 'pf1',
          name: 'PF',
          accountId: 'inv',
          currency: 'USD',
          holdings: [{ symbol: 'AAPL', name: 'AAPL', quantity: 1, avgCost: 100, currentValue: 100 }],
        },
      ],
    };
    const uiFx = 3.75;
    const getAvailableCashForAccount = () => ({ SAR: 0, USD: 0 });
    const opts = { getAvailableCashForAccount, simulatedPrices: {} as Record<string, { price: number }> };
    const wrongUiBuckets = computePersonalNetWorthChartBucketsSAR(data, uiFx, opts);
    const headline = computePersonalHeadlineNetWorthSar(data, uiFx, opts);
    expect(headline.sarPerUsd).toBe(resolveSarPerUsd(data, uiFx));
    expect(headline.sarPerUsd).toBe(4);
    expect(wrongUiBuckets.investments).not.toBe(headline.buckets.investments);
    expect(headline.buckets.investments).toBeGreaterThan(wrongUiBuckets.investments);
  });

  it('puts direct Sukuk positions into the investments bucket, not physical assets', () => {
    const data: any = {
      accounts: [{ id: 'inv', type: 'Investment', balance: 0 }],
      assets: [{ type: 'Property', value: 4800 }],
      sukukPositions: [
        {
          id: 'sk1',
          name: 'Gov Sukuk',
          investmentAccountId: 'inv',
          currency: 'SAR',
          faceValue: 1200,
          outstandingPrincipal: 1200,
          issueDate: '2024-01-01',
          maturityDate: '2027-01-01',
          status: 'active',
        },
      ],
      liabilities: [],
      commodityHoldings: [],
      investments: [],
    };
    const buckets = computePersonalNetWorthChartBucketsSAR(data, 3.75);
    expect(buckets.investments).toBe(1200);
    expect(buckets.physicalAndCommodities).toBe(4800);
    const breakdown = computePersonalNetWorthBreakdownSAR(data, 3.75);
    expect(buckets.netWorth).toBe(breakdown.netWorth);
  });
});
