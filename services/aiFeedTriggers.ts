/**
 * Light proactive-feed refresh signals.
 * Prefer window event `finova:ai-feed-refresh` so Feed can idle-refresh without invasive DataContext hooks.
 */

const FEED_REFRESH_EVENT = 'finova:ai-feed-refresh';

let stale = false;

/** Mark the AI Feed as needing a refresh (e.g. after a trade). */
export function markAiFeedStale(): void {
  stale = true;
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FEED_REFRESH_EVENT));
    }
  } catch {
    /* ignore */
  }
}

/** Consume and clear the stale flag. Returns whether a refresh was pending. */
export function consumeAiFeedStale(): boolean {
  const was = stale;
  stale = false;
  return was;
}

export function isAiFeedStale(): boolean {
  return stale;
}

export const AI_FEED_REFRESH_EVENT = FEED_REFRESH_EVENT;

/** Fire the window event (and mark stale) after a successful trade. */
export function requestAiFeedRefresh(): void {
  markAiFeedStale();
}
