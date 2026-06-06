/** Yield the main thread so navigation paint and input stay responsive during heavy work. */
export function yieldToMain(timeoutMs = 0): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => resolve(), { timeout: Math.max(16, timeoutMs) });
      return;
    }
    setTimeout(resolve, Math.max(0, timeoutMs));
  });
}
