import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('auth session stability', () => {
  it('supabase client persists sessions with explicit auth storage', () => {
    const src = read('services/supabaseClient.ts');
    expect(src).toContain('persistSession: true');
    expect(src).toContain('autoRefreshToken: true');
  });

  it('profile sync defers refreshSession after sign-in', () => {
    const src = read('services/syncUserApprovalProfile.ts');
    expect(src).toContain('markAuthSignInForProfileSync');
    expect(src).toContain('lastAuthSignInAtMs');
    expect(src).toMatch(/expiresAt.*120/);
  });

  it('AuthContext does not await profile sync inside onAuthStateChange', () => {
    const src = read('context/AuthContext.tsx');
    expect(src).toContain('queueMicrotask');
    expect(src).toMatch(/onAuthStateChange[\s\S]*?queueMicrotask/);
    expect(src).toContain("event === 'SIGNED_OUT'");
  });

  it('PendingApprovalPage does not cross-origin redirect (session loss)', () => {
    const src = read('pages/PendingApprovalPage.tsx');
    expect(src).not.toMatch(/window\.location\.replace\(target\)/);
  });

  it('deploy freshness banner does not auto-reload after login', () => {
    const src = read('hooks/useDeployFreshness.ts');
    expect(src).not.toContain('window.location.reload');
  });
});
