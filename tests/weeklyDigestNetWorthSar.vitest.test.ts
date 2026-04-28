import { describe, it, expect } from 'vitest';
import type { FinancialData } from '../types';
import { computePersonalNetWorthBreakdownSAR } from '../services/personalNetWorth';
import { computeWeeklyDigestPersonalNetWorthSar } from '../services/weeklyDigestNetWorthSar';
import { computeBrokerCashByAccountMap } from '../services/investmentCashLedger';
import { resolveSarPerUsd } from '../utils/currencyMath';

describe('computeWeeklyDigestPersonalNetWorthSar', () => {
  it('matches computePersonalNetWorthBreakdownSAR with the same platform-cash closure (Accounts balance)', () => {
    const data = {
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

    const fx = resolveSarPerUsd(data, 3.75);
    const cashMap = computeBrokerCashByAccountMap(data.accounts ?? []);
    const getAvailableCashForAccount = (id: string) => cashMap[id] ?? { SAR: 0, USD: 0 };
    const expected = computePersonalNetWorthBreakdownSAR(data, fx, { getAvailableCashForAccount }).netWorth;
    const got = computeWeeklyDigestPersonalNetWorthSar(data, 3.75);
    expect(got).toBe(expected);
  });
});
