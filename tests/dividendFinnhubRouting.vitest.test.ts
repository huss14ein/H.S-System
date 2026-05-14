import { describe, expect, it } from 'vitest';
import { listDividendEligibleHoldings } from '../services/dividendFinnhubSync';
import type { InvestmentPortfolio } from '../types';

function portfolio(symbols: Array<{ symbol: string; holdingType?: string }>): InvestmentPortfolio[] {
  return [
    {
      id: 'p1',
      name: 'Portfolio',
      accountId: 'acc1',
      currency: 'USD',
      holdings: symbols.map((h, i) => ({
        id: `h${i}`,
        symbol: h.symbol,
        quantity: 10,
        avgCost: 100,
        currentValue: 1000,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        holdingType: h.holdingType ?? 'ticker',
      })),
    },
  ];
}

describe('dividend Finnhub routing', () => {
  it('only lists US equity holdings for Finnhub dividend sync', () => {
    expect(
      listDividendEligibleHoldings(
        portfolio([
          { symbol: 'AAPL' },
          { symbol: 'BRK.B' },
          { symbol: '2222.SR' },
          { symbol: '2222.SA' },
          { symbol: 'TADAWUL:2222' },
          { symbol: 'BTC' },
          { symbol: 'MSFT', holdingType: 'manual_fund' },
        ]),
      ).map((row) => row.symbol),
    ).toEqual(['AAPL', 'BRK.B']);
  });
});
