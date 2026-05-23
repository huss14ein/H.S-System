import { describe, expect, it } from 'vitest';
import { approvalFlagsFromUserRow } from '../utils/userApproval';

describe('approvalFlagsFromUserRow', () => {
  it('treats Admin role as approved even when approved=false', () => {
    const flags = approvalFlagsFromUserRow({ role: 'Admin', approved: false, signup_rejected: false });
    expect(flags?.approved).toBe(true);
    expect(flags?.signupRejected).toBe(false);
  });

  it('blocks Restricted when approved=false', () => {
    const flags = approvalFlagsFromUserRow({ role: 'Restricted', approved: false, signup_rejected: false });
    expect(flags?.approved).toBe(false);
  });

  it('legacy rows without approved column are approved', () => {
    const flags = approvalFlagsFromUserRow({ role: 'Restricted' });
    expect(flags?.approved).toBe(true);
  });
});
