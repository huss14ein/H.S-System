import { isRateLimitError } from './quoteRefreshCooldown';

/** After this many 429/quota errors in one batch, bubble up to trigger client cooldown. */
export const RATE_LIMIT_THROW_THRESHOLD = 2;

export function shouldAbortBatchForRateLimit(rateLimitHits: number, successCount: number): boolean {
  if (rateLimitHits <= 0) return false;
  if (successCount === 0) return true;
  return rateLimitHits >= RATE_LIMIT_THROW_THRESHOLD;
}

export function noteProviderRateLimitError(err: unknown): boolean {
  return isRateLimitError(err);
}

export function buildRateLimitBatchError(provider: string): Error {
  return new Error(`${provider} rate limit (429). Wait before retrying live quotes.`);
}
