import { describe, it, expect } from 'vitest';
import {
  computePersonalHeadlineNetWorthSar,
  computePersonalNetWorthBreakdownSAR,
} from '../services/personalNetWorth';
import type { FinancialData } from '../types';

describe('computePersonalHeadlineNetWorthSar', () => {
  it('matches breakdown net worth for the same FX and options', () => {
    const data = {
      accounts: [
        { id: 'a1', name: 'Chk', type: 'Checking', balance: 1000, currency: 'SAR' },
      ],
      assets: [],
      liabilities: [],
      commodityHoldings: [],
      investments: [],
      transactions: [],
      budgets: [],
    } as unknown as FinancialData;
    const fx = 3.75;
    const getCash = () => ({ SAR: 0, USD: 0 });
    const h = computePersonalHeadlineNetWorthSar(data, fx, { getAvailableCashForAccount: getCash });
    const b = computePersonalNetWorthBreakdownSAR(data, h.sarPerUsd, { getAvailableCashForAccount: getCash });
    expect(h.netWorth).toBe(b.netWorth);
    expect(h.buckets.netWorth).toBe(h.netWorth);
  });
});
