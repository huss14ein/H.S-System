import { describe, expect, it } from 'vitest';
import { approvalFlagsFromSync } from '../services/syncUserApprovalProfile';
import { isSignupApprovalEnforced, resolveEffectiveAppAccess } from '../utils/userApproval';

describe('approvalFlagsFromSync', () => {
  it('blocks unapproved Restricted when signup approval is enforced', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Restricted', approved: false, signup_rejected: false },
      null,
    );
    expect(flags.approved).toBe(false);
    if (isSignupApprovalEnforced()) {
      expect(flags.hardBlockShell).toBe(true);
    }
  });

  it('treats Admin as approved even when approved=false', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Admin', approved: false, signup_rejected: false },
      null,
    );
    expect(flags.approved).toBe(true);
    expect(flags.hardBlockShell).toBe(false);
  });

  it('does not bypass approval using email_confirmed_at alone (security)', () => {
    const flags = resolveEffectiveAppAccess(
      { role: 'Restricted', approved: false, signup_rejected: false },
      { email_confirmed_at: '2026-01-01T00:00:00Z' } as import('@supabase/supabase-js').User,
    );
    expect(flags.approved).toBe(false);
    expect(flags.signupRejected).toBe(false);
  });

  it('hard-blocks rejected signups', () => {
    const flags = resolveEffectiveAppAccess(
      { role: 'Restricted', approved: false, signup_rejected: true },
      null,
    );
    expect(flags.hardBlockShell).toBe(true);
    expect(flags.signupRejected).toBe(true);
  });

  it('allows approved users', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Restricted', approved: true, signup_rejected: false },
      null,
    );
    expect(flags.approved).toBe(true);
    expect(flags.hardBlockShell).toBe(false);
  });
});
