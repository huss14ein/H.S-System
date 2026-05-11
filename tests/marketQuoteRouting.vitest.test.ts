import { describe, expect, it } from 'vitest';
import {
  isCommodityOrProviderSymbol,
  isTadawulQuoteSymbol,
  isUsEquityQuoteSymbol,
  uniqueQuoteSymbols,
} from '../services/marketQuoteRouting';

describe('market quote routing', () => {
  it('routes Tadawul aliases away from Finnhub', () => {
    expect(isTadawulQuoteSymbol('2222.SR')).toBe(true);
    expect(isTadawulQuoteSymbol('2222.SA')).toBe(true);
    expect(isTadawulQuoteSymbol('TADAWUL:2222')).toBe(true);
    expect(isUsEquityQuoteSymbol('2222.SR')).toBe(false);
    expect(isUsEquityQuoteSymbol('2222.SA')).toBe(false);
  });

  it('routes only conservative US equity-looking symbols to Finnhub', () => {
    expect(isUsEquityQuoteSymbol('AAPL')).toBe(true);
    expect(isUsEquityQuoteSymbol('BRK.B')).toBe(true);
    expect(isUsEquityQuoteSymbol('BRK-B')).toBe(true);
    expect(isUsEquityQuoteSymbol('GROWTH')).toBe(false);
    expect(isUsEquityQuoteSymbol('LARGE-CAP')).toBe(false);
    expect(isUsEquityQuoteSymbol('MASHORAH')).toBe(false);
  });

  it('keeps commodities/provider symbols away from equity quote providers', () => {
    expect(isCommodityOrProviderSymbol('OANDA:XAU_USD')).toBe(true);
    expect(isCommodityOrProviderSymbol('XAU_GRAM_24K')).toBe(true);
    expect(isCommodityOrProviderSymbol('BTC_USD')).toBe(true);
    expect(isUsEquityQuoteSymbol('OANDA:XAU_USD')).toBe(false);
  });

  it('deduplicates symbols case-insensitively while preserving first spelling', () => {
    expect(uniqueQuoteSymbols(['aapl', 'AAPL', '2222.SR', '2222.sr', ''])).toEqual(['aapl', '2222.SR']);
  });
});
