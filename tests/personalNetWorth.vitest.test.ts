import { describe, expect, it } from 'vitest';
import {
  computePersonalNetWorthBreakdownSAR,
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
});
