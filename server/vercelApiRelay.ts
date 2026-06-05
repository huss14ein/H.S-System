/**
 * Vercel `/api/*` relay: browser CORS on Vercel, server-to-server call to Netlify functions
 * without `Origin` (avoids stale Netlify CORS on production). Keys stay on Netlify only.
 *
 * Self-contained (no imports from `netlify/functions/*`) so Vercel serverless can bundle it.
 */
export const NETLIFY_FUNCTIONS_ORIGIN = 'https://finova-hussein.netlify.app';

const ALLOWED_BROWSER_ORIGINS = new Set([
  'https://h-s-system.vercel.app',
  'https://finova-hussein.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8888',
]);

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

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Browser Origin allowlist — production hosts + dev localhost + Vercel/Netlify previews. */
export function assertVercelRelayOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_BROWSER_ORIGINS.has(origin)) return true;
  const host = hostnameFromOrigin(origin);
  if (!host) return false;
  if (host.endsWith('.vercel.app')) return true;
  if (host.endsWith('.netlify.app') && host.includes('finova-hussein')) return true;
  if (/^localhost$|^127\.0\.0\.1$/i.test(host)) return true;
  return false;
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
