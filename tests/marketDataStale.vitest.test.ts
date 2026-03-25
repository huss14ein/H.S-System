import { describe, expect, it } from 'vitest';
import { getStaleQuoteSymbols } from '../services/dataQuality';

describe('getStaleQuoteSymbols', () => {
  it('when countMissingTimestampAsStale is false, omits symbols with no timestamp', () => {
    const syms = getStaleQuoteSymbols(['AAA', 'BBB'], { BBB: new Date().toISOString() }, true, {
      countMissingTimestampAsStale: false,
    });
    expect(syms).toEqual([]);
  });

  it('when countMissingTimestampAsStale is true, lists symbols with no timestamp', () => {
    const syms = getStaleQuoteSymbols(['AAA'], {}, true);
    expect(syms).toContain('AAA');
  });
});
