/** Bridge so header/platform refresh can nudge MarketSimulator immediately (not only via effect re-run). */
let kickQuoteRefreshFn: (() => void) | null = null;
let syncQuoteCacheSessionFn: (() => void) | null = null;
let clearPendingLiveFetchFn: (() => void) | null = null;

export function registerQuoteRefreshKick(fn: (() => void) | null): void {
  kickQuoteRefreshFn = fn;
}

export function kickQuoteRefreshNow(): void {
  kickQuoteRefreshFn?.();
}

/** Clear MarketSimulator overflow queue when user cancels refresh. */
export function registerClearPendingLiveFetch(fn: (() => void) | null): void {
  clearPendingLiveFetchFn = fn;
}

export function clearPendingLiveFetchSymbols(): void {
  clearPendingLiveFetchFn?.();
}

/** Re-apply persisted quote cache into session (late fetch / cross-tab). */
export function registerQuoteCacheSessionSync(fn: (() => void) | null): void {
  syncQuoteCacheSessionFn = fn;
}

export function syncQuoteCacheToSessionNow(): void {
  syncQuoteCacheSessionFn?.();
}
