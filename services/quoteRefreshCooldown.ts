/** Client-side backoff after provider rate limits (SAHMK / Finnhub / proxy). */

/** Default after Finnhub / generic proxy 429. */
const COOLDOWN_MS = 45_000;
/**
 * SAHMK free tier is ~100 quotes/day — a short cooldown re-hammers the limit and hangs the UI.
 * Keep client quiet for 10 minutes after any SAHMK 429.
 */
export const SAHMK_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
type CooldownEndListener = () => void;
const cooldownEndListeners = new Set<CooldownEndListener>();

export function isQuoteRefreshInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function quoteRefreshCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

/** Additive subscription — UI hooks must not replace MarketSimulator drain handlers. */
export function subscribeQuoteRefreshCooldownEnd(listener: CooldownEndListener): () => void {
  cooldownEndListeners.add(listener);
  return () => {
    cooldownEndListeners.delete(listener);
  };
}

/** @deprecated Prefer `subscribeQuoteRefreshCooldownEnd` — kept for tests. */
export function setQuoteRefreshCooldownEndListener(listener: CooldownEndListener | null): void {
  cooldownEndListeners.clear();
  if (listener) cooldownEndListeners.add(listener);
}

function notifyCooldownEnd(): void {
  for (const listener of cooldownEndListeners) {
    try {
      listener();
    } catch (e) {
      console.error('quoteRefreshCooldown listener failed:', e);
    }
  }
}

export function startQuoteRefreshCooldown(ms: number = COOLDOWN_MS): void {
  const requested = Number.isFinite(ms) ? Number(ms) : COOLDOWN_MS;
  const waitMs = Math.max(5_000, requested);
  // Never shorten an existing longer cooldown (e.g. SAHMK 10m then Finnhub 45s).
  const nextUntil = Date.now() + waitMs;
  if (nextUntil <= cooldownUntil) return;
  cooldownUntil = nextUntil;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  const delay = Math.max(0, cooldownUntil - Date.now());
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    if (Date.now() >= cooldownUntil) notifyCooldownEnd();
  }, delay);
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|rate.?limit|throttl|quota|RESOURCE_EXHAUSTED/i.test(msg);
}

/** Test helper */
export function resetQuoteRefreshCooldownListenersForTests(): void {
  cooldownEndListeners.clear();
}

/** Test helper — clears active cooldown window. */
export function resetQuoteRefreshCooldownForTests(): void {
  cooldownUntil = 0;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
}
