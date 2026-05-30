/**
 * Optional gate for Netlify proxies (AI, Stooq, SAHMK): verify the caller holds a valid
 * Supabase **access** JWT signed with the project JWT secret.
 *
 * Enable with Netlify env: `PROXY_REQUIRE_SUPABASE_JWT=1` and set `SUPABASE_JWT_SECRET`
 * (Dashboard → Settings → API → JWT Secret). Optionally set `SUPABASE_URL` to enforce JWT `iss`
 * (`<SUPABASE_URL>/auth/v1`), matching tokens issued by Supabase Auth.
 */

import type { HandlerEvent } from '@netlify/functions';
import { jwtVerify, type JWTPayload } from 'jose';

function isProductionRuntime(): boolean {
  return (
    process.env.CONTEXT === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * JWT gate for Netlify proxies. Explicit opt-out: `PROXY_REQUIRE_SUPABASE_JWT=0`.
 * Explicit opt-in: `PROXY_REQUIRE_SUPABASE_JWT=1`.
 * Default in production: require JWT when `SUPABASE_JWT_SECRET` is configured.
 */
export function isProxyJwtVerificationEnabled(): boolean {
  const v = (process.env.PROXY_REQUIRE_SUPABASE_JWT || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return isProductionRuntime() && Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
}

export function extractBearerToken(event: HandlerEvent): string | null {
  const h = event.headers ?? {};
  const auth = (h.authorization ?? h.Authorization) as string | undefined;
  if (!auth || typeof auth !== 'string') return null;
  const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
  return m?.[1]?.trim() ?? null;
}

function supabaseJwtIssuer(): string | undefined {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/auth/v1` : undefined;
}

/** Returns payload on success, or null if invalid / misconfigured. */
export async function verifySupabaseAccessToken(token: string): Promise<JWTPayload | null> {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) {
    console.error('proxySupabaseJwt: SUPABASE_JWT_SECRET is not set (required when PROXY_REQUIRE_SUPABASE_JWT is enabled).');
    return null;
  }
  const key = new TextEncoder().encode(secret);
  const issuer = supabaseJwtIssuer();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      ...(issuer ? { issuer } : {}),
    });
    return payload;
  } catch (e) {
    if (process.env.NETLIFY_DEV === 'true' || process.env.CONTEXT === 'dev') {
      console.warn('proxySupabaseJwt: verify failed', e instanceof Error ? e.message : e);
    }
    return null;
  }
}

export type ProxyJwtGateResult =
  | { ok: true }
  | { ok: false; statusCode: number; body: Record<string, string> };

export async function assertProxySupabaseJwt(event: HandlerEvent): Promise<ProxyJwtGateResult> {
  if (!isProxyJwtVerificationEnabled()) return { ok: true };
  const token = extractBearerToken(event);
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error:
          'Authentication required. Send Authorization: Bearer <Supabase access_token> from a signed-in session.',
      },
    };
  }
  const payload = await verifySupabaseAccessToken(token);
  if (!payload?.sub) {
    return { ok: false, statusCode: 401, body: { error: 'Invalid or expired access token.' } };
  }
  return { ok: true };
}
