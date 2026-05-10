import './loadNetlifyFunctionEnv';
import type { Handler, HandlerEvent } from '@netlify/functions';
import { accessControlOriginHeader, assertBrowserOriginAllowed } from './corsAllowlist';
import { assertProxySupabaseJwt } from './proxySupabaseJwt';

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

  try {
    const url = `${SAHMK_BASE}/quote/${encodeURIComponent(code)}/`;
    const res = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        ...corsHeaders(event),
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
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
