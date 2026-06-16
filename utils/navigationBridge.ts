/** Bridge so shell navigation can cancel in-flight quote refresh without MarketData context in the shell. */
let cancelQuoteRefreshFn: (() => void) | null = null;

export function registerQuoteRefreshCancel(fn: (() => void) | null): void {
  cancelQuoteRefreshFn = fn;
}

export function cancelQuoteRefreshOnNav(): void {
  cancelQuoteRefreshFn?.();
}
