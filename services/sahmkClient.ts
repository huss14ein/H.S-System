/**
 * SAHMK quotes go through Netlify `/api/sahmk-proxy` so the API key stays server-side only.
 * With plain `vite`, configure a dev proxy to Netlify or run `netlify dev` after setting `SAHMK_API_KEY`.
 */

const PROXY_CANDIDATES = ['/.netlify/functions/sahmk-proxy', '/api/sahmk-proxy'];

/**
 * GET quote JSON for one Tadawul symbol code (e.g. `2222`, `REITF`).
 */
export async function fetchSahmkQuote(symbolCode: string): Promise<Response> {
  const qs = new URLSearchParams({ s: symbolCode.trim().toUpperCase() });
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

  const hint = lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(
    `SAHMK proxy unavailable (${hint}). Deploy Netlify functions and set SAHMK_API_KEY, or run netlify dev locally.`,
  );
}
