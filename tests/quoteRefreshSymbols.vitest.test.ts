import { describe, expect, it } from 'vitest';
import {
  getRefreshableHoldingQuoteSymbols,
  holdingCanUseQuoteRefresh,
  isRefreshableHoldingQuoteSymbol,
} from '../services/quoteRefreshSymbols';

describe('quote refresh symbols', () => {
  it('excludes manual-valued holdings from quote refreshes', () => {
    expect(
      holdingCanUseQuoteRefresh({
        symbol: 'AAPL',
        holdingType: 'manual_fund',
      }),
    ).toBe(false);
    expect(
      holdingCanUseQuoteRefresh({
        symbol: 'MSFT',
        holding_type: 'manual_fund',
      }),
    ).toBe(false);
  });

  it('allows normal ticker holdings', () => {
    expect(holdingCanUseQuoteRefresh({ symbol: 'AAPL', holdingType: 'ticker' })).toBe(true);
    expect(holdingCanUseQuoteRefresh({ symbol: 'MSFT' })).toBe(true);
  });

  it('only allows Tadawul holdings when the symbol ends in .SR', () => {
    expect(isRefreshableHoldingQuoteSymbol('2222.SR')).toBe(true);
    expect(isRefreshableHoldingQuoteSymbol('REITF.SR')).toBe(true);
    expect(isRefreshableHoldingQuoteSymbol('2222.SA')).toBe(false);
    expect(isRefreshableHoldingQuoteSymbol('2222.SC')).toBe(false);
    expect(isRefreshableHoldingQuoteSymbol('2222.SE')).toBe(false);
    expect(isRefreshableHoldingQuoteSymbol('2222')).toBe(false);
    expect(isRefreshableHoldingQuoteSymbol('TADAWUL:2222')).toBe(false);
  });

  it('returns only API-refreshable holding symbols', () => {
    expect(
      getRefreshableHoldingQuoteSymbols([
        { symbol: 'AAPL', holdingType: 'ticker' },
        { symbol: '2222.SR', holdingType: 'ticker' },
        { symbol: '2222.SA', holdingType: 'ticker' },
        { symbol: 'MSFT', holdingType: 'manual_fund' },
        { symbol: 'TADAWUL:1120', holdingType: 'ticker' },
      ]),
    ).toEqual(['AAPL', '2222.SR']);
  });
});
