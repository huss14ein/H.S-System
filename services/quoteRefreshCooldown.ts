/** Client-side backoff after provider rate limits (SAHMK / Finnhub / proxy). */

const COOLDOWN_MS = 45_000;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
type CooldownEndListener = () => void;
let cooldownEndListener: CooldownEndListener | null = null;

export function isQuoteRefreshInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function quoteRefreshCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

/** MarketSimulator registers to resume pending symbol batches after cooldown. */
export function setQuoteRefreshCooldownEndListener(listener: CooldownEndListener | null): void {
  cooldownEndListener = listener;
}

export function startQuoteRefreshCooldown(ms: number = COOLDOWN_MS): void {
  const waitMs = Math.max(5_000, ms);
  cooldownUntil = Date.now() + waitMs;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    if (Date.now() >= cooldownUntil) cooldownEndListener?.();
  }, waitMs);
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|rate.?limit|throttl|quota|RESOURCE_EXHAUSTED/i.test(msg);
}
