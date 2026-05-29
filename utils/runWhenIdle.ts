/** Schedule work after paint without blocking navigation / hydrate (requestIdleCallback with timeout fallback). */
export function scheduleIdleWork(work: () => void, timeoutMs = 2000): () => void {
  if (typeof window === 'undefined') {
    work();
    return () => {};
  }
  let cancelled = false;
  const run = () => {
    if (!cancelled) work();
  };
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      cancelled = true;
      w.cancelIdleCallback?.(id);
    };
  }
  const t = window.setTimeout(run, 32);
  return () => {
    cancelled = true;
    window.clearTimeout(t);
  };
}
