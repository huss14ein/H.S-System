/**
 * Restrict browser `Origin` headers on Netlify functions so arbitrary websites cannot drive
 * quota/cost abuse against AI or market-data proxies via credentialed or simple fetch.
 *
 * Configure production/preview origins via Netlify env: `URL`, `DEPLOY_PRIME_URL`, `DEPLOY_URL`, or
 * Vercel env: `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VITE_CANONICAL_APP_URL`, or
 * `ALLOWED_ORIGINS` (comma-separated full origins, e.g. `http://localhost:5173,https://app.example.com`).
 * Localhost / 127.0.0.1 / [::1] (any port) are always allowed for dev.
 *
 * Deploy previews (`https://<deploy-id>--<site-slug>.netlify.app`) are allowed automatically when the
 * site slug matches any of `URL` / `DEPLOY_*` / `NETLIFY_SITE_URL` (no need to list every preview in `ALLOWED_ORIGINS`).
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

/**
 * Netlify site slug from `*.netlify.app` hostname: production `mysite.netlify.app` → `mysite`;
 * deploy permalink `abc123--mysite.netlify.app` → `mysite`;
 * unique deploy host `abc123def.netlify.app` → `abc123def` (no `--` separator).
 */
export function netlifySiteSlugFromHostname(hostname: string): string | null {
  const h = hostname.trim().toLowerCase();
  if (!h.endsWith('.netlify.app')) return null;
  const sub = h.slice(0, -'.netlify.app'.length);
  const sep = sub.indexOf('--');
  if (sep === -1) return sub || null;
  return sub.slice(sep + 2) || null;
}

/** Resolve site slug from Netlify-injected URLs (same slug for production + every deploy preview). */
function netlifySiteSlugFromContextEnv(): string | null {
  for (const key of ['URL', 'NETLIFY_SITE_URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL'] as const) {
    const v = process.env[key]?.trim();
    if (!v) continue;
    try {
      const slug = netlifySiteSlugFromHostname(new URL(v).hostname);
      if (slug) return slug;
    } catch {
      /* ignore */
    }
  }
  const name = process.env.NETLIFY_SITE_NAME?.trim().toLowerCase();
  return name || null;
}

/** Browser origin is any *.netlify.app URL for this site (including deploy previews). */
function isNetlifyDeployOrProductionOriginForSite(origin: string, siteSlug: string): boolean {
  try {
    const { hostname } = new URL(origin);
    const oSlug = netlifySiteSlugFromHostname(hostname);
    if (!oSlug) return false;
    return oSlug === siteSlug.toLowerCase();
  } catch {
    return false;
  }
}

/** Baked production origin — works even when Netlify function env is empty. */
const BAKED_DEFAULT_ORIGINS = [
  'https://finova-hussein.netlify.app',
] as const;

/** Hostnames from Netlify deploy env + the host serving this request. */
export function deployedHostnamesFromContext(event?: HandlerEvent): Set<string> {
  const hosts = new Set<string>();
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL', 'NETLIFY_SITE_URL'] as const) {
    const v = process.env[key]?.trim();
    if (!v) continue;
    try {
      hosts.add(new URL(v).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  if (event) {
    const h = requestHostFromEvent(event);
    if (h) hosts.add(h);
  }
  return hosts;
}

/** Origins merged from Netlify deployment env + ALLOWED_ORIGINS. */
export function deployedAllowedOrigins(event?: HandlerEvent): Set<string> {
  const set = new Set<string>();
  for (const baked of BAKED_DEFAULT_ORIGINS) {
    const o = canonicalOrigin(baked);
    if (o) set.add(o);
  }
  const extras = String(process.env.ALLOWED_ORIGINS ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^["']+|["']+$/g, '').trim())
    .filter(Boolean);
  for (const e of extras) {
    const o = canonicalOrigin(e);
    if (o) set.add(o);
  }
  // Include DEPLOY_URL so deploy previews / unique deploy permalinks match the browser Origin
  // (primary URL alone is not enough for https://<hash>--site.netlify.app).
  for (const key of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL', 'NETLIFY_SITE_URL'] as const) {
    const v = process.env[key];
    if (!v?.trim()) continue;
    const o = canonicalOrigin(v.trim());
    if (o) set.add(o);
  }
  // Canonical production URL — set on functions via netlify.toml `[context.*.environment]` (not only `[build.environment]`).
  for (const key of [
    'FINOVA_CANONICAL_APP_URL',
    'CANONICAL_APP_URL',
    'VITE_CANONICAL_APP_URL',
    'VERCEL_URL',
    'VERCEL_BRANCH_URL',
  ] as const) {
    const v = process.env[key]?.trim();
    if (!v) continue;
    const o = canonicalOrigin(v.startsWith('http') ? v : `https://${v}`);
    if (o) set.add(o);
  }
  if (event) {
    for (const host of deployedHostnamesFromContext(event)) {
      const o = canonicalOrigin(`https://${host}`);
      if (o) set.add(o);
    }
  }
  return set;
}

function requestOrigin(event: HandlerEvent): string | undefined {
  const h = event.headers ?? {};
  const raw = (h['origin'] ?? h['Origin']) as string | undefined;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

export function getRequestOrigin(event: HandlerEvent): string | undefined {
  return requestOrigin(event);
}

/** Host serving this function invocation (Netlify sets `x-forwarded-host` / `host`). */
export function requestHostFromEvent(event: HandlerEvent): string | null {
  const h = event.headers ?? {};
  const raw = (h['x-forwarded-host'] ??
    h['X-Forwarded-Host'] ??
    h['host'] ??
    h['Host']) as string | undefined;
  if (!raw || typeof raw !== 'string') return null;
  const host = raw.split(',')[0].trim().toLowerCase();
  return host.replace(/:\d+$/, '') || null;
}

/** SPA and `/api/*` on the same Netlify site — always allow (no `ALLOWED_ORIGINS` env required). */
export function isSameDeploymentOrigin(event: HandlerEvent, origin: string): boolean {
  const host = requestHostFromEvent(event);
  if (!host) return false;
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    return originHost === host;
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string, event?: HandlerEvent): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  if (isPrivateOrLocalNetworkOrigin(origin)) return true;
  const ctxSlug = netlifySiteSlugFromContextEnv();
  if (ctxSlug && isNetlifyDeployOrProductionOriginForSite(origin, ctxSlug)) return true;
  try {
    const oh = new URL(origin).hostname.toLowerCase();
    if (event && deployedHostnamesFromContext(event).has(oh)) return true;
  } catch {
    /* ignore */
  }
  return deployedAllowedOrigins(event).has(origin);
}

export function isOriginAllowedForRequest(event: HandlerEvent, origin: string): boolean {
  if (isSameDeploymentOrigin(event, origin)) return true;
  return isOriginAllowed(origin, event);
}

/**
 * Browser-submitted requests with `Origin` must match the allowlist.
 * Omitting Origin (curl, server-to-server) still reaches the handler — use `PROXY_REQUIRE_SUPABASE_JWT=1`
 * plus `Authorization: Bearer <access_token>` to require a valid Supabase session for AI / market proxies.
 */
export function assertBrowserOriginAllowed(event: HandlerEvent): boolean {
  const origin = requestOrigin(event);
  if (!origin) return true;
  return isOriginAllowedForRequest(event, origin);
}

/** CORS response headers when origin is allowed; missing Origin → no ACAO (same-origin tooling). */
export function accessControlOriginHeader(event: HandlerEvent): Record<string, string> {
  const origin = requestOrigin(event);
  if (!origin || !isOriginAllowedForRequest(event, origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}
