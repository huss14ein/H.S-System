/**
 * Stooq does not allow browser cross-origin access. In production (and when explicitly enabled),
 * CSV/history requests go through Netlify `/api/stooq-proxy` which fetches server-side.
 */

/** Prefer direct Netlify function path first (works even if `/api/*` redirect is misconfigured). */
const PROXY_CANDIDATES = ['/.netlify/functions/stooq-proxy', '/api/stooq-proxy'];

function useBrowserProxy(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_STOOQ_PROXY === '0') return false;
  if (import.meta.env.VITE_STOOQ_PROXY === '1') return true;
  return import.meta.env.PROD;
}

/**
 * Fetch a full Stooq HTTPS URL (must start with https://stooq.com/).
 */
export async function fetchStooq(fullUrl: string): Promise<Response> {
  if (!/^https:\/\/stooq\.com\//i.test(fullUrl)) {
    throw new Error('fetchStooq: expected https://stooq.com/... URL');
  }

  if (!useBrowserProxy()) {
    return fetch(fullUrl);
  }

  const qs = new URLSearchParams({ u: fullUrl });
  let lastError: unknown;
  for (const path of PROXY_CANDIDATES) {
    try {
      const res = await fetch(`${path}?${qs}`);
      if (res.status === 404) continue;
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  const hint =
    lastError instanceof Error
      ? lastError.message
      : 'Check Netlify Functions deploy and netlify.toml /api/* → functions redirect.';
  throw new Error(
    `Stooq CSV proxy is unavailable (${hint}). Browser cannot call stooq.com directly (CORS).`
  );
}
