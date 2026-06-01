import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

describe('user approval security', () => {
  it('resolveEffectiveAppAccess does not read email_confirmed_at', () => {
    const src = readFileSync(path.join(root, 'utils/userApproval.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function resolveEffectiveAppAccess'));
    expect(fn).not.toMatch(/email_confirmed_at/);
    expect(src).not.toMatch(/failOpenApproved/);
  });

  it('syncUserApprovalProfile does not fail-open on verified email client-side', () => {
    const src = readFileSync(path.join(root, 'services/syncUserApprovalProfile.ts'), 'utf8');
    expect(src).not.toMatch(/email_confirmed_at/);
    expect(src).not.toMatch(/failOpenApproved/);
  });

  it('AuthContext fetchApprovalStatus catch does not fail-open in production', () => {
    const src = readFileSync(path.join(root, 'context/AuthContext.tsx'), 'utf8');
    expect(src).toContain('const fetchApprovalStatus = useCallback');
    expect(src).toMatch(/fetchApprovalStatus[\s\S]*?} catch \{[\s\S]*?import\.meta\.env\.DEV[\s\S]*?setApprovalSyncIssue\('network'\)/);
  });

  it('App blocks unapproved users at the shell', () => {
    const src = readFileSync(path.join(root, 'App.tsx'), 'utf8');
    expect(src).toMatch(/!isApproved/);
    expect(src).toContain('PendingApprovalPage');
  });
});
