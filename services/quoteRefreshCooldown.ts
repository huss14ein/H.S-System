/** Client-side backoff after provider rate limits (SAHMK / Finnhub / proxy). */

const COOLDOWN_MS = 45_000;
let cooldownUntil = 0;

export function isQuoteRefreshInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function quoteRefreshCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

export function startQuoteRefreshCooldown(ms: number = COOLDOWN_MS): void {
  cooldownUntil = Date.now() + Math.max(5_000, ms);
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|rate.?limit|throttl|quota|RESOURCE_EXHAUSTED/i.test(msg);
}
