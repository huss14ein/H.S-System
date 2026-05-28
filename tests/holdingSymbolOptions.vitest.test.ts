import { describe, expect, it } from 'vitest';
import {
  buildHoldingSymbolOptions,
  holdingOptionKey,
  holdingSymbolIsOwned,
  resolveHoldingOptionKeyFromSymbol,
} from '../services/holdingSymbolOptions';
import type { InvestmentPortfolio } from '../types';

describe('holdingSymbolOptions', () => {
  const portfolios: InvestmentPortfolio[] = [
    {
      id: 'pf1',
      name: 'Growth',
      accountId: 'acc1',
      currency: 'USD',
      holdings: [
        { id: 'h1', symbol: 'aapl', name: 'Apple', quantity: 10, avgCost: 150, currentValue: 1600, zakahClass: 'Zakatable', realizedPnL: 0 },
        { id: 'h2', symbol: 'MSFT', name: 'Microsoft', quantity: 5, avgCost: 300, currentValue: 1600, zakahClass: 'Zakatable', realizedPnL: 0 },
      ],
    },
    {
      id: 'pf2',
      name: 'SAR sleeve',
      accountId: 'acc2',
      currency: 'SAR',
      holdings: [
        { id: 'h3', symbol: '2222', name: 'Aramco', quantity: 100, avgCost: 30, currentValue: 3000, zakahClass: 'Zakatable', realizedPnL: 0 },
      ],
    },
  ];

  it('builds one option per holding with normalized symbol', () => {
    const opts = buildHoldingSymbolOptions(portfolios);
    expect(opts).toHaveLength(3);
    expect(opts[0].symbol).toBe('2222');
    expect(opts.find((o) => o.symbol === 'AAPL')?.optionKey).toBe(holdingOptionKey('pf1', 'h1'));
    expect(opts.find((o) => o.symbol === 'MSFT')?.bookCurrency).toBe('USD');
  });

  it('resolves key from symbol and portfolio', () => {
    const opts = buildHoldingSymbolOptions(portfolios);
    expect(resolveHoldingOptionKeyFromSymbol(opts, 'MSFT', 'pf1')).toBe(holdingOptionKey('pf1', 'h2'));
    expect(resolveHoldingOptionKeyFromSymbol(opts, 'MSFT')).toBe(holdingOptionKey('pf1', 'h2'));
    expect(resolveHoldingOptionKeyFromSymbol(opts, 'UNKNOWN')).toBe('');
  });

  it('validates owned symbols', () => {
    const opts = buildHoldingSymbolOptions(portfolios);
    expect(holdingSymbolIsOwned(opts, 'AAPL', 'pf1')).toBe(true);
    expect(holdingSymbolIsOwned(opts, 'AAPL', 'pf2')).toBe(false);
    expect(holdingSymbolIsOwned(opts, 'TSLA')).toBe(false);
  });

  it('scopes options to one portfolio when portfolioId is passed', () => {
    const pf1Only = buildHoldingSymbolOptions(portfolios, 'pf1');
    expect(pf1Only).toHaveLength(2);
    expect(pf1Only.every((o) => o.portfolioId === 'pf1')).toBe(true);
    expect(buildHoldingSymbolOptions(portfolios, 'pf2')).toHaveLength(1);
  });
});
