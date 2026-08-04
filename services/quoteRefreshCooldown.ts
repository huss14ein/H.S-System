/** Client-side backoff after provider rate limits (SAHMK / Finnhub / proxy). */

/** Default after Finnhub / generic proxy 429. */
const COOLDOWN_MS = 45_000;
/**
 * SAHMK free tier is ~100 quotes/day — a short cooldown re-hammers the limit and hangs the UI.
 * Keep client quiet for 10 minutes after any SAHMK 429.
 */
export const SAHMK_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

export type QuoteCooldownProvider = 'default' | 'sahmk';

const cooldownUntilByProvider: Record<QuoteCooldownProvider, number> = {
  default: 0,
  sahmk: 0,
};

let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
type CooldownEndListener = () => void;
const cooldownEndListeners = new Set<CooldownEndListener>();

function maxCooldownUntil(): number {
  return Math.max(cooldownUntilByProvider.default, cooldownUntilByProvider.sahmk);
}

/**
 * @param provider Omit for “any provider cooling” (UI banners).
 *   Pass `'default'` to gate Finnhub/generic batches; `'sahmk'` for Tadawul-only.
 */
export function isQuoteRefreshInCooldown(provider?: QuoteCooldownProvider): boolean {
  const now = Date.now();
  if (provider === 'sahmk') return now < cooldownUntilByProvider.sahmk;
  if (provider === 'default') return now < cooldownUntilByProvider.default;
  return now < maxCooldownUntil();
}

export function quoteRefreshCooldownRemainingMs(provider?: QuoteCooldownProvider): number {
  if (provider === 'sahmk') return Math.max(0, cooldownUntilByProvider.sahmk - Date.now());
  if (provider === 'default') return Math.max(0, cooldownUntilByProvider.default - Date.now());
  return Math.max(0, maxCooldownUntil() - Date.now());
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

function scheduleCooldownEndNotify(): void {
  if (cooldownTimer) clearTimeout(cooldownTimer);
  const delay = Math.max(0, maxCooldownUntil() - Date.now());
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    if (Date.now() >= maxCooldownUntil()) notifyCooldownEnd();
  }, delay);
}

export function startQuoteRefreshCooldown(
  ms: number = COOLDOWN_MS,
  provider: QuoteCooldownProvider = 'default',
): void {
  const requested = Number.isFinite(ms) ? Number(ms) : COOLDOWN_MS;
  const waitMs = Math.max(5_000, requested);
  // Never shorten an existing longer cooldown for this provider.
  const nextUntil = Date.now() + waitMs;
  if (nextUntil <= cooldownUntilByProvider[provider]) return;
  cooldownUntilByProvider[provider] = nextUntil;
  scheduleCooldownEndNotify();
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
  cooldownUntilByProvider.default = 0;
  cooldownUntilByProvider.sahmk = 0;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
}
