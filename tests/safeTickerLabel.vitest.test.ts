import { describe, expect, it } from 'vitest';
import { safeTickerLabel } from '../utils/safeTickerLabel';

describe('safeTickerLabel', () => {
  it('keeps ordinary tickers', () => {
    expect(safeTickerLabel('atyr')).toBe('ATYR');
    expect(safeTickerLabel('2222.SR')).toBe('2222.SR');
    expect(safeTickerLabel('BRK-B')).toBe('BRK-B');
  });

  it('rejects script-like or oversized strings', () => {
    expect(safeTickerLabel('<script>alert(1)</script>')).toBe('UNKNOWN');
    expect(safeTickerLabel('javascript:alert(1)')).toBe('UNKNOWN');
    expect(safeTickerLabel('A'.repeat(80))).toBe('UNKNOWN');
  });
});
