/**
 * Restrict browser `Origin` headers on Netlify functions so arbitrary websites cannot drive
 * quota/cost abuse against AI or market-data proxies via credentialed or simple fetch.
 *
 * Configure production/preview origins via Netlify env: `URL`, `DEPLOY_PRIME_URL`, or
 * `ALLOWED_ORIGINS` (comma-separated full origins, e.g. `http://localhost:5173,https://app.example.com`).
 * Localhost / 127.0.0.1 / [::1] (any port) are always allowed for dev.
 */

import type { HandlerEvent } from '@netlify/functions';

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * RFC1918 + link-local + mDNS + Tailscale CGNAT (100.64.0.0/10) — typical dev/LAN access.
 * Public internet browsing of your dev server is still rare; abusers need your IP + port.
 */
function isPrivateOrLocalNetworkOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (/^localhost$|^127\.0\.0\.1$|^\[::1\]$/i.test(hostname)) return true;
    if (hostname.endsWith('.local') || hostname.includes('.local.')) return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^169\.254\./.test(hostname)) return true;
    const m172 = /^172\.(\d+)\./.exec(hostname);
    if (m172) {
      const n = Number(m172[1]);
      if (n >= 16 && n <= 31) return true;
    }
    // Tailscale / CGNAT carrier-grade NAT range 100.64.0.0 – 100.127.255.255
    const m100 = /^100\.(\d+)\./.exec(hostname);
    if (m100) {
      const second = Number(m100[1]);
      if (second >= 64 && second <= 127) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function canonicalOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    try {
      return new URL(`https://${trimmed}`).origin;
    } catch {
      return null;
    }
  }
}

/** Origins merged from Netlify deployment env + ALLOWED_ORIGINS. */
export function deployedAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  const extras = String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const e of extras) {
    const o = canonicalOrigin(e);
    if (o) set.add(o);
  }
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'NETLIFY_SITE_URL'] as const) {
    const v = process.env[key];
    if (!v?.trim()) continue;
    const o = canonicalOrigin(v.trim());
    if (o) set.add(o);
  }
  return set;
}

function requestOrigin(event: HandlerEvent): string | undefined {
  const h = event.headers ?? {};
  const raw = (h['origin'] ?? h['Origin']) as string | undefined;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function isOriginAllowed(origin: string): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  if (isPrivateOrLocalNetworkOrigin(origin)) return true;
  return deployedAllowedOrigins().has(origin);
}

/**
 * Browser-submitted requests with `Origin` must match the allowlist.
 * Omitting Origin (curl, server-to-server) still reaches the handler — use `PROXY_REQUIRE_SUPABASE_JWT=1`
 * plus `Authorization: Bearer <access_token>` to require a valid Supabase session for AI / market proxies.
 */
export function assertBrowserOriginAllowed(event: HandlerEvent): boolean {
  const origin = requestOrigin(event);
  if (!origin) return true;
  return isOriginAllowed(origin);
}

/** CORS response headers when origin is allowed; missing Origin → no ACAO (same-origin tooling). */
export function accessControlOriginHeader(event: HandlerEvent): Record<string, string> {
  const origin = requestOrigin(event);
  if (!origin || !isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}
