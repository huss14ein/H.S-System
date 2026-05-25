import { describe, expect, it } from 'vitest';
import {
  normalizeTadawulUnitPriceSAR,
  sanitizeLiveQuoteRow,
  symbolForLiveQuoteFetch,
} from '../services/tadawulQuoteSanity';

describe('tadawulQuoteSanity', () => {
  it('maps aliases to .SR for live fetch', () => {
    expect(symbolForLiveQuoteFetch('2222')).toBe('2222.SR');
    expect(symbolForLiveQuoteFetch('2222.SA')).toBe('2222.SR');
    expect(symbolForLiveQuoteFetch('TADAWUL:7010')).toBe('7010.SR');
    expect(symbolForLiveQuoteFetch('AAPL')).toBe('AAPL');
  });

  it('converts halala-scale prices using avg cost', () => {
    expect(normalizeTadawulUnitPriceSAR(3200, { avgCostPerShare: 32 })).toBe(32);
    expect(normalizeTadawulUnitPriceSAR(32, { avgCostPerShare: 32 })).toBe(32);
  });

  it('rejects implausible quotes vs cost basis', () => {
    expect(normalizeTadawulUnitPriceSAR(8, { avgCostPerShare: 32 })).toBeNull();
    expect(normalizeTadawulUnitPriceSAR(120, { avgCostPerShare: 32 })).toBeNull();
  });

  it('sanitizeLiveQuoteRow drops bad Tadawul rows', () => {
    expect(
      sanitizeLiveQuoteRow('2222.SR', { price: 5, change: 0, changePercent: 0 }, { avgCostPerShare: 30 }),
    ).toBeUndefined();
    expect(
      sanitizeLiveQuoteRow('2222.SR', { price: 31, change: 1, changePercent: 3 }, { avgCostPerShare: 30 })?.price,
    ).toBe(31);
  });
});
