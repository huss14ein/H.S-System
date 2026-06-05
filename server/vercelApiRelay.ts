/**
 * Vercel `/api/*` relay: browser CORS on Vercel, server-to-server call to Netlify functions
 * without `Origin` (avoids stale Netlify CORS on production). Keys stay on Netlify only.
 */
import type { HandlerEvent } from '@netlify/functions';
import { isOriginAllowedForRequest } from '../netlify/functions/corsAllowlist';

export const NETLIFY_FUNCTIONS_ORIGIN = 'https://finova-hussein.netlify.app';

const BROWSER_ORIGINS = [
  'https://h-s-system.vercel.app',
  'https://finova-hussein.netlify.app',
] as const;

type RelayRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type RelayResponse = {
  status(code: number): RelayResponse;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  send(body: string): void;
  json(body: unknown): void;
};

function vercelServingHost(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return vercel.replace(/:\d+$/, '').toLowerCase();
  return 'h-s-system.vercel.app';
}

function mockCorsEvent(origin: string | undefined): HandlerEvent {
  const host = vercelServingHost();
  return {
    headers: {
      ...(origin ? { origin, Origin: origin } : {}),
      host,
      Host: host,
      'x-forwarded-host': host,
    },
  } as HandlerEvent;
}

/** Browser Origin allowlist — Vercel production + Netlify + localhost (via corsAllowlist). */
export function assertVercelRelayOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (BROWSER_ORIGINS.includes(origin as (typeof BROWSER_ORIGINS)[number])) return true;
  return isOriginAllowedForRequest(mockCorsEvent(origin), origin);
}

function applyCors(res: RelayResponse, origin: string | undefined, methods: string): void {
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (origin && assertVercelRelayOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

function queryStringFromUrl(url: string | undefined): string {
  if (!url || !url.includes('?')) return '';
  return url.slice(url.indexOf('?'));
}

/**
 * Relay a Vercel API route to Netlify functions with correct browser CORS on the Vercel side.
 */
export async function relayToNetlifyFunction(
  req: RelayRequest,
  res: RelayResponse,
  netlifyPath: string,
  opts: { methods: readonly string[]; allowBody?: boolean },
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

  if (method === 'OPTIONS') {
    if (origin && !assertVercelRelayOriginAllowed(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    applyCors(res, origin, opts.methods.join(', '));
    res.status(200).end();
    return;
  }

  if (!opts.methods.includes(method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (origin && !assertVercelRelayOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  const upstreamUrl = `${NETLIFY_FUNCTIONS_ORIGIN}${netlifyPath}${queryStringFromUrl(req.url)}`;
  const headers: Record<string, string> = {};
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers['Content-Type'] = contentType;
  const auth = req.headers.authorization;
  if (typeof auth === 'string') headers.Authorization = auth;

  let body: string | undefined;
  if (opts.allowBody !== false && method !== 'GET' && method !== 'HEAD') {
    body =
      typeof req.body === 'string'
        ? req.body
        : req.body !== undefined
          ? JSON.stringify(req.body)
          : undefined;
  }

  const upstream = await fetch(upstreamUrl, { method, headers, body });
  const text = await upstream.text();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) res.setHeader('Content-Type', upstreamType);
  applyCors(res, origin, opts.methods.join(', '));
  res.status(upstream.status).send(text);
}
