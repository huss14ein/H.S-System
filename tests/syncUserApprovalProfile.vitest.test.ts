import { describe, expect, it } from 'vitest';
import { approvalFlagsFromSync } from '../services/syncUserApprovalProfile';
import { resolveEffectiveAppAccess } from '../utils/userApproval';

describe('approvalFlagsFromSync', () => {
  it('uses row flags when profile exists', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Restricted', approved: false, signup_rejected: false },
      false,
      null,
    );
    expect(flags.approved).toBe(false);
    expect(flags.hardBlockShell).toBe(false);
  });

  it('treats Admin as approved even when approved=false', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Admin', approved: false, signup_rejected: false },
      false,
      null,
    );
    expect(flags.approved).toBe(true);
  });

  it('allows verified email through stale approved=false rows (mobile RPC fallback)', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Restricted', approved: false, signup_rejected: false },
      false,
      { email_confirmed_at: '2026-01-01T00:00:00Z' } as import('@supabase/supabase-js').User,
    );
    expect(flags.approved).toBe(true);
    expect(flags.hardBlockShell).toBe(false);
  });

  it('hard-blocks only rejected signups', () => {
    const flags = resolveEffectiveAppAccess(
      { role: 'Restricted', approved: false, signup_rejected: true },
      null,
      false,
    );
    expect(flags.hardBlockShell).toBe(true);
  });
});
