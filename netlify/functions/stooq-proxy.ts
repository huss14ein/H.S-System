import type { Handler, HandlerEvent } from '@netlify/functions';

/**
 * Server-side fetch to Stooq (CSV). Browsers cannot call Stooq directly from production
 * origins because Stooq does not send Access-Control-Allow-Origin.
 *
 * GET /api/stooq-proxy?u=https://stooq.com/...
 * Only https://stooq.com/* targets are allowed (no open proxy).
 */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

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
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: 'Method not allowed',
    };
  }

  const raw = event.queryStringParameters?.u ?? '';
  if (!raw || !isAllowedStooqUrl(raw)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
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
        ...corsHeaders,
        'Content-Type': res.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
      },
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('stooq-proxy fetch failed:', message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      body: `Upstream error: ${message}`,
    };
  }
};

export { handler };
