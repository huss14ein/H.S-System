import { describe, expect, it } from 'vitest';
import {
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

  it('zeros daily change when US market is closed (weekend ET)', () => {
    const satEt = new Date('2026-06-06T18:00:00Z');
    expect(isUsEquityRegularSessionOpen(satEt)).toBe(false);
    expect(quoteChangeForDailyPnL('AAPL', 2.5, satEt)).toBe(0);
  });

  it('zeros daily change when Tadawul is closed (Friday AST)', () => {
    const friRiyadh = new Date('2026-06-05T10:00:00Z');
    expect(isTadawulRegularSessionOpen(friRiyadh)).toBe(false);
    expect(quoteChangeForDailyPnL('2222.SR', 1.2, friRiyadh)).toBe(0);
  });

  it('allows daily change during US regular hours', () => {
    const wedEt = new Date('2026-06-03T15:00:00Z');
    expect(isEquityDailyPnLSessionOpen('AAPL', wedEt)).toBe(true);
    expect(quoteChangeForDailyPnL('AAPL', 1.5, wedEt)).toBe(1.5);
  });
});
