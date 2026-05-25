import { describe, it, expect } from 'vitest';
import type { FinancialData } from '../types';
import { computePersonalHeadlineNetWorthSar, computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';
import {
  buildWeeklyDigestNetWorthOptions,
  computeWeeklyDigestPersonalNetWorthSar,
} from '../services/weeklyDigestNetWorthSar';

const digestFixture = {
  accounts: [
    { id: 'a-check', name: 'C', type: 'Checking' as const, balance: 1000 },
    {
      id: 'a-inv',
      name: 'Inv',
      type: 'Investment' as const,
      balance: 400,
      currency: 'USD' as const,
    },
  ],
  assets: [{ id: 'ast', name: 'Home', type: 'Property' as const, value: 500000 }],
  liabilities: [],
  commodityHoldings: [],
  investments: [
    {
      id: 'p1',
      name: 'P',
      accountId: 'a-inv',
      currency: 'USD' as const,
      holdings: [],
    },
  ],
  investmentTransactions: [
    {
      id: 'tx1',
      accountId: 'a-inv',
      portfolioId: 'p1',
      date: '2025-01-01',
      type: 'deposit' as const,
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: 400,
      currency: 'USD' as const,
    },
  ],
  wealthUltraConfig: { fxRate: 3.75 },
} as unknown as FinancialData;

describe('computeWeeklyDigestPersonalNetWorthSar', () => {
  it('matches headline NW with digest platform-cash options (stored marks, no live quotes)', () => {
    const uiExchangeRate = 3.75;
    const opts = buildWeeklyDigestNetWorthOptions(digestFixture);
    const headline = computePersonalHeadlineNetWorthSar(digestFixture, uiExchangeRate, opts);
    const got = computeWeeklyDigestPersonalNetWorthSar(digestFixture, uiExchangeRate);
    expect(got).toBe(headline.netWorth);
  });

  it('breakdown net worth matches headline when platform cash is provided', () => {
    const uiExchangeRate = 3.75;
    const opts = buildWeeklyDigestNetWorthOptions(digestFixture);
    const headline = computePersonalHeadlineNetWorthSar(digestFixture, uiExchangeRate, opts);
    const breakdown = computePersonalNetWorthBreakdownSAR(digestFixture, uiExchangeRate, opts);
    expect(breakdown.netWorth).toBe(headline.netWorth);
  });
});
