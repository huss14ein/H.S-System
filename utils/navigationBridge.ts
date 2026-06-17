/** Bridge so shell navigation can resume quote refresh after route pause (never abort in-flight fetches). */
let resumeQuoteRefreshFn: (() => void) | null = null;

export function registerQuoteRefreshResume(fn: (() => void) | null): void {
  resumeQuoteRefreshFn = fn;
}

/** After nav pause ends, nudge the quote queue — does not cancel network work. */
export function resumeQuoteRefreshAfterNav(): void {
  resumeQuoteRefreshFn?.();
}
