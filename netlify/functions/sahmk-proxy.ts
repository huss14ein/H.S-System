import './loadNetlifyFunctionEnv';
import type { Handler, HandlerEvent } from '@netlify/functions';
import { accessControlOriginHeader, assertBrowserOriginAllowed } from './corsAllowlist';
import { assertProxySupabaseJwt } from './proxySupabaseJwt';
import { getQuoteEdgeCached, quoteEdgeCacheKey, setQuoteEdgeCached } from './quoteEdgeCache';

/**
 * Proxy for SAHMK (sahmk.sa) Tadawul quotes — browsers must not hold the API key.
 * Set `SAHMK_API_KEY` in Netlify environment variables (Dashboard → Site → Env).
 *
 * GET /api/sahmk-proxy?s=2222   or   ?symbol=REITF
 */

function corsHeaders(event: HandlerEvent): Record<string, string> {
  return {
    ...accessControlOriginHeader(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

const SAHMK_BASE = 'https://app.sahmk.sa/api/v1';
const CACHE_429_TTL_MS = 20_000;
const CACHE_5XX_TTL_MS = 10_000;

/** Allow Tadawul / Nomu symbol codes (numeric or alnum, no injection). */
function isAllowedSymbol(raw: string): boolean {
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(s);
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    if (!assertBrowserOriginAllowed(event)) {
      return { statusCode: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' };
    }
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(event), body: 'Method not allowed' };
  }

  if (!assertBrowserOriginAllowed(event)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Origin not allowed' }),
    };
  }

  const jwtGate = await assertProxySupabaseJwt(event);
  if (!jwtGate.ok) {
    return {
      statusCode: jwtGate.statusCode,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(jwtGate.body),
    };
  }

  const raw = event.queryStringParameters?.s ?? event.queryStringParameters?.symbol ?? '';
  if (!raw || !isAllowedSymbol(raw)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Missing or invalid parameter s / symbol (Tadawul code)' }),
    };
  }

  const code = raw.trim().toUpperCase();
  const apiKey = process.env.SAHMK_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'SAHMK_API_KEY is not set. Add it in Netlify → Site configuration → Environment variables.',
      }),
    };
  }

  const cacheKey = quoteEdgeCacheKey('sahmk', code);
  const cached = getQuoteEdgeCached(cacheKey);
  if (cached) {
    return {
      statusCode: cached.status,
      headers: {
        ...corsHeaders(event),
        'Content-Type': cached.contentType,
        'X-Quote-Cache': 'HIT',
      },
      body: cached.body,
    };
  }

  try {
    const url = `${SAHMK_BASE}/quote/${encodeURIComponent(code)}/`;
    const res = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
    });
    const body = await res.text();
    const contentType = res.headers.get('Content-Type') ?? 'application/json; charset=utf-8';
    const retryAfter = res.headers.get('Retry-After') ?? undefined;
    const shouldCache =
      res.ok || res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (shouldCache) {
      const ttl =
        res.ok ? undefined : res.status === 429 ? CACHE_429_TTL_MS : CACHE_5XX_TTL_MS;
      setQuoteEdgeCached(cacheKey, { status: res.status, body, contentType }, ttl);
    }
    return {
      statusCode: res.status,
      headers: {
        ...corsHeaders(event),
        'Content-Type': contentType,
        ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
        'X-Quote-Cache': 'MISS',
        ...(res.ok
          ? {}
          : res.status === 429
            ? { 'X-Quote-Cache-TTL': String(Math.round(CACHE_429_TTL_MS / 1000)) }
            : res.status >= 500 && res.status <= 599
              ? { 'X-Quote-Cache-TTL': String(Math.round(CACHE_5XX_TTL_MS / 1000)) }
              : {}),
      },
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('sahmk-proxy:', message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: message }),
    };
  }
};

export { handler };
