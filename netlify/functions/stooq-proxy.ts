import type { Handler, HandlerEvent } from '@netlify/functions';
import { accessControlOriginHeader, assertBrowserOriginAllowed } from './corsAllowlist';
import { assertProxySupabaseJwt } from './proxySupabaseJwt';

/**
 * Server-side fetch to Stooq (CSV). Browsers cannot call Stooq directly from production
 * origins because Stooq does not send Access-Control-Allow-Origin.
 *
 * GET /api/stooq-proxy?u=https://stooq.com/...
 * Only https://stooq.com/* targets are allowed (no open proxy).
 */

function corsHeaders(event: HandlerEvent): Record<string, string> {
  return {
    ...accessControlOriginHeader(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function isAllowedStooqUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && /^stooq\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    if (!assertBrowserOriginAllowed(event)) {
      return { statusCode: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' };
    }
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(event),
      body: 'Method not allowed',
    };
  }

  if (!assertBrowserOriginAllowed(event)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Origin not allowed',
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

  const raw = event.queryStringParameters?.u ?? '';
  if (!raw || !isAllowedStooqUrl(raw)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(event), 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Invalid or missing parameter u (must be https://stooq.com/...)',
    };
  }

  try {
    const res = await fetch(raw, {
      headers: { Accept: 'text/csv,text/plain,*/*' },
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: {
        ...corsHeaders(event),
        'Content-Type': res.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
      },
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('stooq-proxy fetch failed:', message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders(event), 'Content-Type': 'text/plain; charset=utf-8' },
      body: `Upstream error: ${message}`,
    };
  }
};

export { handler };
