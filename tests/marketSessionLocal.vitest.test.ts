import { describe, expect, it } from 'vitest';
import {
  isAnyEquityMarketRegularSessionOpen,
  isEquityDailyPnLSessionOpen,
  isTadawulRegularSessionOpen,
  isUsEquityRegularSessionOpen,
  quoteChangeForDailyPnL,
  resolveEquityListingExchange,
} from '../services/marketSessionLocal';

describe('marketSessionLocal', () => {
  it('resolves US vs Tadawul listings', () => {
    expect(resolveEquityListingExchange('AAPL')).toBe('US');
    expect(resolveEquityListingExchange('2222.SR')).toBe('TADAWUL');
    expect(resolveEquityListingExchange('XAUUSD')).toBeNull();
  });

  it('returns provider day change regardless of session clock', () => {
    const satEt = new Date('2026-06-06T18:00:00Z');
    expect(isUsEquityRegularSessionOpen(satEt)).toBe(false);
    expect(quoteChangeForDailyPnL('AAPL', 2.5, satEt)).toBe(2.5);
  });

  it('returns Tadawul day change when Friday AST session closed', () => {
    const friRiyadh = new Date('2026-06-05T10:00:00Z');
    expect(isTadawulRegularSessionOpen(friRiyadh)).toBe(false);
    expect(quoteChangeForDailyPnL('2222.SR', 1.2, friRiyadh)).toBe(1.2);
  });

  it('allows daily change during US regular hours', () => {
    const wedEt = new Date('2026-06-03T15:00:00Z');
    expect(isEquityDailyPnLSessionOpen('AAPL', wedEt)).toBe(true);
    expect(quoteChangeForDailyPnL('AAPL', 1.5, wedEt)).toBe(1.5);
  });

  it('isAnyEquityMarketRegularSessionOpen when US or Tadawul is open', () => {
    const wedEt = new Date('2026-06-03T15:00:00Z');
    expect(isAnyEquityMarketRegularSessionOpen(wedEt)).toBe(true);
    const satEt = new Date('2026-06-06T18:00:00Z');
    expect(isAnyEquityMarketRegularSessionOpen(satEt)).toBe(false);
  });
});
