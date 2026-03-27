import { describe, it, expect } from 'vitest';
import { toFinnhubSymbol, fromFinnhubSymbol, toStooqSymbol } from '../services/finnhubService';

describe('Tadawul / Saudi symbol mapping', () => {
  it('maps .SR .SA and .SE to Finnhub TADAWUL prefix', () => {
    expect(toFinnhubSymbol('2222.SR')).toBe('TADAWUL:2222');
    expect(toFinnhubSymbol('2222.SA')).toBe('TADAWUL:2222');
    expect(toFinnhubSymbol('2222.SE')).toBe('TADAWUL:2222');
  });

  it('normalizes Finnhub response to .SR display key', () => {
    expect(fromFinnhubSymbol('TADAWUL:2222')).toBe('2222.SR');
  });

  it('maps Saudi aliases to Stooq 2222.sr', () => {
    expect(toStooqSymbol('2222.SR')).toBe('2222.sr');
    expect(toStooqSymbol('2222.SA')).toBe('2222.sr');
    expect(toStooqSymbol('2222.SE')).toBe('2222.sr');
  });
});
