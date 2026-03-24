import { describe, it, expect } from 'vitest';
import { earningsEventMatchesTrackedSymbols } from '../services/finnhubService';

describe('earningsEventMatchesTrackedSymbols', () => {
  it('returns all rows when no symbols tracked', () => {
    expect(earningsEventMatchesTrackedSymbols([], 'AAPL')).toBe(true);
  });

  it('matches US ticker case-insensitively', () => {
    expect(earningsEventMatchesTrackedSymbols(['CRMT'], 'CRMT')).toBe(true);
    expect(earningsEventMatchesTrackedSymbols(['crmt'], 'CRMT')).toBe(true);
  });

  it('matches Tadawul holding 2222.SR to Finnhub bare numeric symbol', () => {
    expect(earningsEventMatchesTrackedSymbols(['2222.SR'], '2222')).toBe(true);
    expect(earningsEventMatchesTrackedSymbols(['2222.SR'], '2222.SR')).toBe(true);
  });

  it('does not match unrelated symbols', () => {
    expect(earningsEventMatchesTrackedSymbols(['2222.SR'], 'AAPL')).toBe(false);
    expect(earningsEventMatchesTrackedSymbols(['AAPL'], '2222')).toBe(false);
  });

  it('matches BRK.B style via Finnhub normalization', () => {
    expect(earningsEventMatchesTrackedSymbols(['BRK.B'], 'BRK-B')).toBe(true);
  });
});
