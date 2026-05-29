import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isQuoteRefreshInCooldown,
  isRateLimitError,
  quoteRefreshCooldownRemainingMs,
  startQuoteRefreshCooldown,
} from '../services/quoteRefreshCooldown';

describe('quoteRefreshCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startQuoteRefreshCooldown(0);
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enters cooldown for at least 5s minimum', () => {
    startQuoteRefreshCooldown(1000);
    expect(isQuoteRefreshInCooldown()).toBe(true);
    expect(quoteRefreshCooldownRemainingMs()).toBeGreaterThan(0);
    vi.advanceTimersByTime(6_000);
    expect(isQuoteRefreshInCooldown()).toBe(false);
  });

  it('detects rate-limit style errors', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError('throttled by provider')).toBe(true);
    expect(isRateLimitError(new Error('network timeout'))).toBe(false);
  });
});
