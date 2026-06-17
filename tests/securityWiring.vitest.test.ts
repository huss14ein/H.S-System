import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('security wiring', () => {
  it('.env is gitignored and must not be tracked', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
    const tracked = execSync('git ls-files .env', { encoding: 'utf8' }).trim();
    expect(tracked).toBe('');
  });

  it('vercel.json redirects to Netlify production (single canonical host)', () => {
    const vercel = read('vercel.json');
    expect(vercel).toContain('finova-hussein.netlify.app');
    expect(read('netlify/functions/corsAllowlist.ts')).not.toContain("'Access-Control-Allow-Origin': '*'");
  });

  it('netlify.toml ships security headers', () => {
    const netlify = read('netlify.toml');
    expect(netlify).toContain('X-Frame-Options');
    expect(netlify).toContain('Content-Security-Policy');
  });

  it('Netlify gemini-proxy wires CORS + JWT gates and health bypass', () => {
    const src = read('netlify/functions/gemini-proxy.ts');
    expect(src).toContain('assertBrowserOriginAllowed');
    expect(src).toContain('assertProxySupabaseJwt');
    expect(src).toContain('isHealthProbeBody');
    expect(src).toMatch(/if\s*\(!assertBrowserOriginAllowed\(event\)\)/);
    expect(src).not.toMatch(/!healthProbe && !assertBrowserOriginAllowed/);
    for (const fn of ['stooq-proxy.ts', 'sahmk-proxy.ts']) {
      const proxy = read(`netlify/functions/${fn}`);
      expect(proxy).toContain('assertBrowserOriginAllowed');
      expect(proxy).toContain('assertProxySupabaseJwt');
    }
  });

  it('Supabase gemini-proxy requires JWT when secret is configured', () => {
    const src = read('supabase/functions/gemini-proxy/index.ts');
    expect(src).not.toContain("'Access-Control-Allow-Origin': '*'");
    expect(src).toContain('verifySupabaseAccessToken');
    expect(src).toContain('isJwtGateEnabled');
  });

  it('weekly digest edge function requires shared secret', () => {
    const src = read('supabase/functions/send-weekly-digest/index.ts');
    expect(src).toContain('x-weekly-digest-secret');
    expect(src).toContain('WEEKLY_DIGEST_SECRET');
  });

  it('send-review-pack edge function uses origin allowlist CORS (no wildcard)', () => {
    const src = read('supabase/functions/send-review-pack/index.ts');
    expect(src).not.toContain("'Access-Control-Allow-Origin': '*'");
    expect(src).toContain('allowedOrigins');
    expect(src).toContain('Origin not allowed');
  });

  it('signup approval uses server profile sync without client email bypass', () => {
    const approval = read('utils/userApproval.ts');
    const fn = approval.slice(approval.indexOf('export function resolveEffectiveAppAccess'));
    expect(fn).not.toMatch(/email_confirmed_at/);
    expect(read('services/syncUserApprovalProfile.ts')).toContain('ensure_own_user_profile');
    expect(read('supabase/migrations/20260617100000_security_hardening.sql')).not.toContain(
      'email_confirmed is not null',
    );
  });

  it('admin role inferred from DB only', () => {
    expect(read('utils/role.ts')).not.toContain('user_metadata');
    expect(read('utils/role.ts')).not.toContain('app_metadata');
  });

  it('wealth_ultra_config has RLS migration', () => {
    expect(read('supabase/migrations/20260617100000_security_hardening.sql')).toContain(
      'wealth_ultra_config_select_own_or_global',
    );
  });
});
