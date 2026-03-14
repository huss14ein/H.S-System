/**
 * Shared helpers for holding symbol/label used in Investments and tests.
 */

/** Safe symbol for holdings (ticker or manual_fund). Use for lookups and display. */
export function safeSymbol(s: string | undefined): string {
  return (s ?? '').trim();
}

/** Display label for a holding: symbol, name, or "Manual". */
export function holdingDisplayLabel(h: { symbol?: string; name?: string }): string {
  return h.symbol || h.name || 'Manual';
}
