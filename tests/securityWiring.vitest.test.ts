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

  it('vercel.json ships security headers', () => {
    const vercel = read('vercel.json');
    expect(vercel).toContain('X-Frame-Options');
    expect(vercel).toContain('Content-Security-Policy');
    expect(vercel).toContain('Strict-Transport-Security');
  });

  it('netlify.toml ships security headers', () => {
    const netlify = read('netlify.toml');
    expect(netlify).toContain('X-Frame-Options');
    expect(netlify).toContain('Content-Security-Policy');
  });

  it('Netlify proxies wire CORS + JWT gates', () => {
    for (const fn of ['gemini-proxy.ts', 'stooq-proxy.ts', 'sahmk-proxy.ts']) {
      const src = read(`netlify/functions/${fn}`);
      expect(src).toContain('assertBrowserOriginAllowed');
      expect(src).toContain('assertProxySupabaseJwt');
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

  it('signup approval uses server profile sync without client email bypass', () => {
    const approval = read('utils/userApproval.ts');
    const fn = approval.slice(approval.indexOf('export function resolveEffectiveAppAccess'));
    expect(fn).not.toMatch(/email_confirmed_at/);
    expect(read('services/syncUserApprovalProfile.ts')).toContain('ensure_own_user_profile');
  });
});
