import { describe, expect, it } from 'vitest';
import {
  buildUpcomingDividendPayouts,
  inferDividendCadence,
  nextEstimatedPayoutDates,
  receivedQuartersYtdSar,
} from '../services/dividendExpectedSchedule';

describe('dividendExpectedSchedule', () => {
  it('infers cadence from distribution', () => {
    expect(inferDividendCadence({ dividendDistribution: 'Reinvest' })).toBe('reinvest');
    expect(inferDividendCadence({ dividendDistribution: 'Payout' })).toBe('quarterly');
  });

  it('builds upcoming quarterly payouts', () => {
    const items = buildUpcomingDividendPayouts({
      holdingRows: [
        {
          portfolioId: 'p1',
          portfolioName: 'Main',
          symbol: 'XOM',
          name: 'Exxon',
          expectedAnnualSar: 4000,
          dividendDistribution: 'Payout',
        },
      ],
      now: new Date('2026-01-15'),
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].amountSar).toBeCloseTo(1000, 0);
  });

  it('aggregates received by quarter YTD', () => {
    const q = receivedQuartersYtdSar({
      dividendTransactions: [
        {
          id: '1',
          type: 'dividend',
          symbol: 'AAPL',
          portfolioId: 'p1',
          accountId: 'a1',
          date: '2026-02-10',
          quantity: 0,
          price: 0,
          total: 100,
          currency: 'USD',
        },
      ],
      portfolioId: 'p1',
      symbol: 'AAPL',
      accounts: [{ id: 'a1', name: 'B', type: 'Investment', balance: 0 }],
      portfolios: [],
      data: null,
      uiExchangeRate: 3.75,
      year: 2026,
    });
    expect(q[0]).toBeGreaterThan(0);
  });

  it('returns payout dates for quarterly cadence', () => {
    const dates = nextEstimatedPayoutDates({ cadence: 'quarterly', now: new Date('2026-01-01'), count: 2 });
    expect(dates.length).toBe(2);
  });
});
