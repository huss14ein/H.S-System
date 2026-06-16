/**
 * Yield the main thread so navigation paint and input stay responsive during heavy work.
 * Uses setTimeout (not requestIdleCallback) so long compute is never attributed to an idle handler.
 */
export function yieldToMain(delayMs = 0): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    window.setTimeout(resolve, Math.max(0, delayMs));
  });
}
