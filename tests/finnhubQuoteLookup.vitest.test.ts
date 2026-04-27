import { describe, it, expect } from 'vitest';
import {
  lookupLiveQuoteForSymbol,
  expandLiveQuotesForRequestedSymbols,
  type LiveQuoteRow,
} from '../services/finnhubService';

describe('lookupLiveQuoteForSymbol', () => {
  it('matches Saudi aliases on the quote map', () => {
    const tick: LiveQuoteRow = { price: 28.5, change: 0.5, changePercent: 1.79 };
    const quoted = {
      '2222': tick,
      '2222.SR': tick,
    };
    expect(lookupLiveQuoteForSymbol(quoted, '2222.SR')).toEqual(tick);
    expect(lookupLiveQuoteForSymbol(quoted, '2222')).toEqual(tick);
    expect(lookupLiveQuoteForSymbol(quoted, '2222.sa')).toEqual(tick);
  });

  it('finds by canonical key when only provider-side keys exist', () => {
    const tick: LiveQuoteRow = { price: 100, change: 1, changePercent: 1 };
    const quoted = { '1180.SE': tick };
    expect(lookupLiveQuoteForSymbol(quoted, '1180.SR')).toEqual(tick);
  });
});

describe('expandLiveQuotesForRequestedSymbols', () => {
  it('writes each requested spelling onto the map', () => {
    const tick: LiveQuoteRow = { price: 28.5, change: 0.5, changePercent: 1 };
    const requested = ['2222.SR'];
    const quotes = { '2222': tick };
    const out = expandLiveQuotesForRequestedSymbols(requested, quotes);
    expect(out['2222.SR']).toEqual(tick);
    expect(out['2222']).toEqual(tick);
  });
});
