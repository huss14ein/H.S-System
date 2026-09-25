import { describe, expect, it } from 'vitest';
import {
  buildPriceMapAtAsOf,
  closeOnOrBefore,
  priceMapWithAliases,
} from '../services/periodStartMarks';

describe('periodStartMarks', () => {
  it('closeOnOrBefore picks the last close on or before as-of', () => {
    const closes = [
      { dayMs: Date.parse('2026-05-01T00:00:00Z'), price: 10 },
      { dayMs: Date.parse('2026-05-08T00:00:00Z'), price: 11 },
      { dayMs: Date.parse('2026-05-15T00:00:00Z'), price: 12 },
    ];
    expect(closeOnOrBefore(closes, Date.parse('2026-05-10T00:00:00Z'))).toBe(11);
    expect(closeOnOrBefore(closes, Date.parse('2026-05-15T00:00:00Z'))).toBe(12);
    expect(closeOnOrBefore(closes, Date.parse('2026-04-01T00:00:00Z'))).toBeUndefined();
  });

  it('buildPriceMapAtAsOf aliases symbols for quote lookup', () => {
    const map = buildPriceMapAtAsOf(
      {
        '2222.SR': [{ dayMs: Date.parse('2026-05-01T00:00:00Z'), price: 30 }],
      },
      Date.parse('2026-05-02T00:00:00Z'),
    );
    expect(map['2222.SR']?.price).toBe(30);
    expect(map['2222']?.price).toBe(30);
    expect(priceMapWithAliases('AAPL', 100).AAPL?.price).toBe(100);
  });
});
