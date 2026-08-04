import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isQuoteRefreshInCooldown,
  isRateLimitError,
  quoteRefreshCooldownRemainingMs,
  startQuoteRefreshCooldown,
  resetQuoteRefreshCooldownForTests,
  subscribeQuoteRefreshCooldownEnd,
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

  it('notifies when the earlier provider clears while another is still cooling', () => {
    const onEnd = vi.fn();
    subscribeQuoteRefreshCooldownEnd(onEnd);
    startQuoteRefreshCooldown(10_000, 'default');
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS, 'sahmk');
    vi.advanceTimersByTime(10_500);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isQuoteRefreshInCooldown('default')).toBe(false);
    expect(isQuoteRefreshInCooldown('sahmk')).toBe(true);
    vi.advanceTimersByTime(SAHMK_RATE_LIMIT_COOLDOWN_MS);
    expect(onEnd).toHaveBeenCalledTimes(2);
    expect(isQuoteRefreshInCooldown()).toBe(false);
  });

  it('detects rate-limit style errors', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError('throttled by provider')).toBe(true);
    expect(isRateLimitError(new Error('network timeout'))).toBe(false);
  });
});
