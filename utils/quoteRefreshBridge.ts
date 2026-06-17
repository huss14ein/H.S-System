/** Bridge so header/platform refresh can nudge MarketSimulator immediately (not only via effect re-run). */
let kickQuoteRefreshFn: (() => void) | null = null;

export function registerQuoteRefreshKick(fn: (() => void) | null): void {
  kickQuoteRefreshFn = fn;
}

export function kickQuoteRefreshNow(): void {
  kickQuoteRefreshFn?.();
}
