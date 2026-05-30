import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import type { HandlerEvent } from '@netlify/functions';
import {
  extractBearerToken,
  isProxyJwtVerificationEnabled,
  verifySupabaseAccessToken,
} from '../netlify/functions/proxySupabaseJwt';

describe('proxySupabaseJwt', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.PROXY_REQUIRE_SUPABASE_JWT;
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('extractBearerToken parses Authorization header', () => {
    const ev = {
      headers: { authorization: 'Bearer abc.def.ghi' },
    } as HandlerEvent;
    expect(extractBearerToken(ev)).toBe('abc.def.ghi');
  });

  it('isProxyJwtVerificationEnabled reads env', () => {
    expect(isProxyJwtVerificationEnabled()).toBe(false);
    process.env.PROXY_REQUIRE_SUPABASE_JWT = '1';
    expect(isProxyJwtVerificationEnabled()).toBe(true);
  });

  it('isProxyJwtVerificationEnabled defaults on in production when JWT secret is set', () => {
    delete process.env.PROXY_REQUIRE_SUPABASE_JWT;
    process.env.CONTEXT = 'production';
    process.env.SUPABASE_JWT_SECRET = 'prod-secret-at-least-32-characters-long';
    expect(isProxyJwtVerificationEnabled()).toBe(true);
  });

  it('isProxyJwtVerificationEnabled can be disabled explicitly in production', () => {
    process.env.CONTEXT = 'production';
    process.env.SUPABASE_JWT_SECRET = 'prod-secret-at-least-32-characters-long';
    process.env.PROXY_REQUIRE_SUPABASE_JWT = '0';
    expect(isProxyJwtVerificationEnabled()).toBe(false);
  });

  it('verifySupabaseAccessToken accepts HS256 token signed with JWT secret', async () => {
    process.env.SUPABASE_JWT_SECRET = 'unit-test-jwt-secret-at-least-32-chars-long';
    const key = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    const token = await new SignJWT({ sub: 'user-xyz' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(key);

    const payload = await verifySupabaseAccessToken(token);
    expect(payload?.sub).toBe('user-xyz');
  });

  it('verifySupabaseAccessToken enforces issuer when SUPABASE_URL is set', async () => {
    process.env.SUPABASE_JWT_SECRET = 'unit-test-jwt-secret-at-least-32-chars-long';
    process.env.SUPABASE_URL = 'https://test-project.supabase.co';
    const key = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    const tokenNoIss = await new SignJWT({ sub: 'user-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(key);
    expect(await verifySupabaseAccessToken(tokenNoIss)).toBeNull();

    const tokenOk = await new SignJWT({ sub: 'user-b' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer('https://test-project.supabase.co/auth/v1')
      .sign(key);
    const payload = await verifySupabaseAccessToken(tokenOk);
    expect(payload?.sub).toBe('user-b');
  });
});
