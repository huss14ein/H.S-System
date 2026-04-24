import { describe, expect, it } from 'vitest';
import {
  computePersonalNetWorthBreakdownSAR,
  computePersonalNetWorthChartBucketsSAR,
  computePersonalNetWorthSAR,
} from '../services/personalNetWorth';

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

  it('puts Sukuk (Assets) into the investments bucket, not physical assets', () => {
    const data: any = {
      accounts: [{ type: 'Checking', balance: 0 }],
      assets: [
        { type: 'Sukuk', value: 1200 },
        { type: 'Property', value: 4800 },
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
