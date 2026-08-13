const TICKER_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * Display-safe ticker — rejects script-like or oversized strings before confirm/toast/HTML.
 */
export function safeTickerLabel(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (TICKER_RE.test(s)) return s.toUpperCase();
  const compact = s.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32);
  return TICKER_RE.test(compact) ? compact.toUpperCase() : 'UNKNOWN';
}
