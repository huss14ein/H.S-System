import { describe, it, expect } from 'vitest';
import { validateTrade } from '../services/dataQuality/validation';
import {
  flowsFromInvestmentTransactionsInSAR,
  flowsFromInvestmentTransactionsInSARWithDatedFx,
} from '../services/portfolioXirr';
import { approximatePortfolioMWRR } from '../services/portfolioXirr';
import { dividendAlreadyRecorded } from '../services/dividendFinnhubSync';

describe('validateTrade dividend', () => {
  it('accepts dividend with positive total and symbol', () => {
    const v = validateTrade({
      type: 'dividend',
      total: 42.5,
      symbol: 'AAPL',
      date: '2024-06-01',
      quantity: 0,
      price: 0,
    });
    expect(v.valid).toBe(true);
  });

  it('rejects dividend without symbol', () => {
    const v = validateTrade({ type: 'dividend', total: 10, symbol: '', date: '2024-06-01' });
    expect(v.valid).toBe(false);
  });
});

describe('flowsFromInvestmentTransactionsInSAR', () => {
  it('treats dividends as positive investor flows', () => {
    const flows = flowsFromInvestmentTransactionsInSAR(
      [
        { date: '2024-01-01', type: 'deposit', total: 1000, currency: 'USD' },
        { date: '2024-06-01', type: 'dividend', total: 25, currency: 'USD' },
      ],
      3.75,
    );
    const div = flows.find((f) => f.date.startsWith('2024-06'));
    expect(div?.amount).toBeCloseTo(25 * 3.75, 5);
    const dep = flows.find((f) => f.date.startsWith('2024-01'));
    expect(dep?.amount).toBeCloseTo(-1000 * 3.75, 5);
  });
});

describe('flowsFromInvestmentTransactionsInSARWithDatedFx', () => {
  it('uses per-day SAR/USD when map is hydrated', () => {
    const data = { wealthUltraConfig: { fxRate: 3.75 } };
    const flows = flowsFromInvestmentTransactionsInSARWithDatedFx(
      [{ date: '2024-01-15', type: 'deposit', total: 100, currency: 'USD' }],
      data as any,
      3.75,
    );
    expect(flows[0]?.amount).toBeCloseTo(-375, 5);
  });
});

describe('approximatePortfolioMWRR with dividends + terminal', () => {
  it('returns a finite rate when flows and terminal are coherent', () => {
    const flows = flowsFromInvestmentTransactionsInSAR(
      [{ date: '2024-01-01', type: 'deposit', total: 1000, currency: 'USD' }],
      4,
    );
    const term = 1000 * 4 + 50; // holdings + small cash in SAR
    const r = approximatePortfolioMWRR(flows, term, '2025-01-01');
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!)).toBe(true);
  });
});

describe('dividendAlreadyRecorded', () => {
  it('detects same-day duplicate', () => {
    const dup = dividendAlreadyRecorded({
      transactions: [
        {
          id: '1',
          accountId: 'acc1',
          date: '2024-03-15T00:00:00.000Z',
          type: 'dividend',
          symbol: 'AAPL',
          quantity: 0,
          price: 0,
          total: 12.34,
          currency: 'USD',
        },
      ],
      accounts: [{ id: 'acc1', name: 'P', type: 'Investment', balance: 0 }],
      accountId: 'acc1',
      symbol: 'AAPL',
      payDate: '2024-03-15',
      totalBook: 12.34,
      bookCurrency: 'USD',
    });
    expect(dup).toBe(true);
  });
});
