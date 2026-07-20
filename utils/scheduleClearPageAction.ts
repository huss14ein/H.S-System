/**
 * Clear a consumed pageAction on the next macrotask.
 * Survives React Strict Mode remount: cleanup cancels the pending clear so the
 * remounted effect still sees the same `pageAction` and can re-apply UI state
 * (e.g. open Record Trade) before clearing.
 */
export function scheduleClearPageAction(clearPageAction?: (() => void) | null): () => void {
  if (!clearPageAction) return () => {};
  const t = setTimeout(() => {
    clearPageAction();
  }, 0);
  return () => clearTimeout(t);
}
