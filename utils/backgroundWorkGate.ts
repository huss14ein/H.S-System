/**
 * Short-lived pause window while the user navigates or interacts.
 * Background quote/metrics work checks this so it does not compete with route paint.
 */

const DEFAULT_PAUSE_MS = 2_500;

let pausedUntilMs = 0;

export function pauseBackgroundWork(ms: number = DEFAULT_PAUSE_MS): void {
  pausedUntilMs = Math.max(pausedUntilMs, Date.now() + Math.max(0, ms));
}

export function isBackgroundWorkPaused(): boolean {
  return Date.now() < pausedUntilMs;
}

export function backgroundWorkPauseRemainingMs(): number {
  return Math.max(0, pausedUntilMs - Date.now());
}

/** Test helper */
export function resetBackgroundWorkGateForTests(): void {
  pausedUntilMs = 0;
}
