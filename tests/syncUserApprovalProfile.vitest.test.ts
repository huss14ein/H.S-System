import { describe, expect, it } from 'vitest';
import { approvalFlagsFromSync } from '../services/syncUserApprovalProfile';

describe('approvalFlagsFromSync', () => {
  it('uses row flags when profile exists', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Restricted', approved: false, signup_rejected: false },
      false,
    );
    expect(flags.approved).toBe(false);
  });

  it('treats Admin as approved even when approved=false', () => {
    const flags = approvalFlagsFromSync(
      { role: 'Admin', approved: false, signup_rejected: false },
      false,
    );
    expect(flags.approved).toBe(true);
  });

  it('fail-opens when ensure RPC is missing on server', () => {
    expect(approvalFlagsFromSync(null, true).approved).toBe(true);
    expect(approvalFlagsFromSync(null, false).approved).toBe(false);
  });
});
