import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isQuoteRefreshInCooldown,
  isRateLimitError,
  quoteRefreshCooldownRemainingMs,
  startQuoteRefreshCooldown,
  resetQuoteRefreshCooldownForTests,
  SAHMK_RATE_LIMIT_COOLDOWN_MS,
} from '../services/quoteRefreshCooldown';

describe('quoteRefreshCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetQuoteRefreshCooldownForTests();
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetQuoteRefreshCooldownForTests();
  });

  it('enters cooldown for at least 5s minimum', () => {
    startQuoteRefreshCooldown(1000);
    expect(isQuoteRefreshInCooldown()).toBe(true);
    expect(quoteRefreshCooldownRemainingMs()).toBeGreaterThan(0);
    vi.advanceTimersByTime(6_000);
    expect(isQuoteRefreshInCooldown()).toBe(false);
  });

  it('does not shorten an existing longer cooldown on the same provider', () => {
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'default');
    const remaining = quoteRefreshCooldownRemainingMs('default');
    startQuoteRefreshCooldown(5_000, 'default');
    expect(quoteRefreshCooldownRemainingMs('default')).toBeGreaterThanOrEqual(remaining - 50);
  });

  it('SAHMK cooldown does not block default/Finnhub provider', () => {
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk');
    expect(isQuoteRefreshInCooldown('sahmk')).toBe(true);
    expect(isQuoteRefreshInCooldown('default')).toBe(false);
    expect(isQuoteRefreshInCooldown()).toBe(true); // any
  });

  it('detects rate-limit style errors', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError('throttled by provider')).toBe(true);
    expect(isRateLimitError(new Error('network timeout'))).toBe(false);
  });
});
