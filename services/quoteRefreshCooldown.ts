/** Client-side backoff after provider rate limits (SAHMK / Finnhub / proxy). */

const COOLDOWN_MS = 45_000;
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
  const waitMs = Math.max(5_000, ms);
  cooldownUntil = Date.now() + waitMs;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    if (Date.now() >= cooldownUntil) notifyCooldownEnd();
  }, waitMs);
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|rate.?limit|throttl|quota|RESOURCE_EXHAUSTED/i.test(msg);
}

/** Test helper */
export function resetQuoteRefreshCooldownListenersForTests(): void {
  cooldownEndListeners.clear();
}
