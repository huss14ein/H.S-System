import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inferIsAdmin } from '../utils/role';
import { isSafeExternalUrl, safeExternalHref } from '../utils/safeExternalUrl';
import { isSignupApprovalEnforced } from '../utils/userApproval';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('safeExternalUrl', () => {
  it('allows https and http', () => {
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true);
    expect(safeExternalHref('https://finnhub.io/docs')).toBe('https://finnhub.io/docs');
  });

  it('blocks javascript and data URIs', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(safeExternalHref('javascript:void(0)')).toBeNull();
  });
});

describe('role and approval hardening', () => {
  it('inferIsAdmin trusts DB role only', () => {
    const fakeUser = { user_metadata: { role: 'admin' } } as any;
    expect(inferIsAdmin(fakeUser, null)).toBe(false);
    expect(inferIsAdmin(fakeUser, 'Admin')).toBe(true);
    expect(read('utils/role.ts')).not.toContain('user_metadata');
  });
});

describe('page security coverage', () => {
  const pageFiles = readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.tsx'));

  it('every page module avoids dangerous HTML sinks', () => {
    const publicPages = new Set(['LoginPage.tsx', 'SignupPage.tsx', 'PendingApprovalPage.tsx']);
    for (const file of pageFiles) {
      const src = read(`pages/${file}`);
      expect(src, file).not.toContain('dangerouslySetInnerHTML');
      expect(src, file).not.toMatch(/\beval\s*\(/);
      if (!publicPages.has(file)) {
        expect(src, file).not.toContain('localStorage.getItem(\'token\')');
      }
    }
  });

  it('AI grounding links use safeExternalHref on Investments and Assets', () => {
    expect(read('pages/Investments.tsx')).toContain('safeExternalHref');
    expect(read('pages/Assets.tsx')).toContain('safeExternalHref');
    expect(read('pages/Investments.tsx')).not.toMatch(/href=\{chunk\.web\.uri\}/);
    expect(read('pages/Assets.tsx')).not.toMatch(/href=\{chunk\.web\.uri\}/);
  });

  it('App gates authenticated shell', () => {
    const app = read('App.tsx');
    expect(app).toContain('if (!isAuthenticated)');
    expect(app).toContain('approvalHardBlock');
    expect(app).toContain('AuthenticatedAppShell');
  });

  it('AuthenticatedAppShell validates hash routes', () => {
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('VALID_PAGES');
  });

  it('AuthContext fails closed without Supabase', () => {
    expect(read('context/AuthContext.tsx')).toContain('setIsAdmin(false)');
    expect(read('context/AuthContext.tsx')).not.toMatch(/!currentSupabase[\s\S]{0,400}setIsAdmin\(true\)/);
  });

  it('security migration adds wealth_ultra_config RLS and fixes signup approval', () => {
    const mig = read('supabase/migrations/20260617100000_security_hardening.sql');
    expect(mig).toContain('wealth_ultra_config');
    expect(mig).toContain('enable row level security');
    expect(mig).not.toMatch(/email_confirmed is not null[\s\S]{0,80}approved = true/);
    expect(mig).toContain('coalesce(usr.approved, false) = true');
  });

  it('markdown renderer avoids raw HTML', () => {
    expect(read('components/SafeMarkdownRenderer.tsx')).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('isSignupApprovalEnforced', () => {
  it('is always true in production builds', () => {
    if (!import.meta.env.DEV) {
      expect(isSignupApprovalEnforced()).toBe(true);
    }
  });
});
