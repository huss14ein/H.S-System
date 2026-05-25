import { describe, expect, it } from 'vitest';
import { computeTopDividendEarnersFromLedger } from '../services/dividendLedgerRankings';
import type { InvestmentTransaction } from '../types';

describe('computeTopDividendEarnersFromLedger', () => {
  it('ranks symbols by SAR received in trailing window', () => {
    const txs: InvestmentTransaction[] = [
      {
        id: '1',
        type: 'dividend',
        symbol: 'AAPL',
        date: '2026-03-01',
        total: 400,
        currency: 'USD',
        accountId: 'acc1',
        portfolioId: 'p1',
        quantity: 0,
        price: 0,
      },
      {
        id: '2',
        type: 'dividend',
        symbol: 'MSFT',
        date: '2026-02-15',
        total: 100,
        currency: 'USD',
        accountId: 'acc1',
        portfolioId: 'p1',
        quantity: 0,
        price: 0,
      },
      {
        id: '3',
        type: 'dividend',
        symbol: 'AAPL',
        date: '2026-01-10',
        total: 200,
        currency: 'USD',
        accountId: 'acc1',
        portfolioId: 'p1',
        quantity: 0,
        price: 0,
      },
    ];

    const rows = computeTopDividendEarnersFromLedger({
      dividendTransactions: txs,
      accounts: [{ id: 'acc1', name: 'Broker', type: 'Investment', balance: 0, currency: 'USD' }],
      portfolios: [{ id: 'p1', name: 'Main', accountId: 'acc1', holdings: [] }],
      data: null,
      uiExchangeRate: 3.75,
      nameBySymbol: { AAPL: 'Apple', MSFT: 'Microsoft' },
      limit: 5,
    });

    expect(rows[0]?.symbol).toBe('AAPL');
    expect(rows[0]?.paymentCount).toBe(2);
    expect(rows[0]?.name).toBe('Apple');
    expect(rows[1]?.symbol).toBe('MSFT');
  });
});
