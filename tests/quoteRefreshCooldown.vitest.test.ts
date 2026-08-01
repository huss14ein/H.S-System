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

  it('does not shorten an existing longer cooldown', () => {
    startQuoteRefreshCooldown(SAHMK_RATE_LIMIT_COOLDOWN_MS);
    const remaining = quoteRefreshCooldownRemainingMs();
    startQuoteRefreshCooldown(5_000);
    expect(quoteRefreshCooldownRemainingMs()).toBeGreaterThanOrEqual(remaining - 50);
  });

  it('detects rate-limit style errors', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError('throttled by provider')).toBe(true);
    expect(isRateLimitError(new Error('network timeout'))).toBe(false);
  });
});
