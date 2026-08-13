const TICKER_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * Display-safe ticker — rejects script-like or oversized strings before confirm/toast/HTML.
 * Only the original trimmed value is accepted (no strip-and-keep, which would turn
 * `<script>alert(1)</script>` into a plausible ticker).
 */
export function safeTickerLabel(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  return TICKER_RE.test(s) ? s.toUpperCase() : 'UNKNOWN';
}
