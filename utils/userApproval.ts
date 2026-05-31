import type { User } from '@supabase/supabase-js';
import { inferIsAdmin } from './role';

/** Map `public.users` row → app access flags. Legacy DB without `approved` → allow access. */
export function approvalFlagsFromUserRow(data: Record<string, unknown> | null): {
  approved: boolean;
  signupRejected: boolean;
} | null {
  if (data == null) return null;
  const role = String(data.role ?? '').trim().toLowerCase();
  const isAdminRole = role === 'admin';
  const hasApprovedKey = Object.prototype.hasOwnProperty.call(data, 'approved');
  const raw = data.approved;
  const approvedCol =
    !hasApprovedKey ? true : raw === null || raw === undefined ? true : Boolean(raw);
  const approved = approvedCol || isAdminRole;
  const hasRejKey = Object.prototype.hasOwnProperty.call(data, 'signup_rejected');
  const signupRejected = approved ? false : hasRejKey && Boolean(data.signup_rejected);
  return { approved, signupRejected };
}

/**
 * Effective shell access after sync. Verified email sessions must not stay blocked when mobile
 * fails to run `ensure_own_user_profile` and reads a stale approved=false row.
 */
export function resolveEffectiveAppAccess(
  row: Record<string, unknown> | null,
  authUser: User | null,
  failOpenApproved: boolean,
): { approved: boolean; signupRejected: boolean; hardBlockShell: boolean } {
  const flags = approvalFlagsFromUserRow(row);
  if (flags?.signupRejected) {
    return { approved: false, signupRejected: true, hardBlockShell: true };
  }

  const dbRole = row ? String(row.role ?? '').trim() : null;
  const emailConfirmed = Boolean(authUser?.email_confirmed_at);
  const approved =
    Boolean(flags?.approved) ||
    inferIsAdmin(authUser, dbRole) ||
    failOpenApproved ||
    emailConfirmed;

  const enforceGate = import.meta.env.VITE_ENFORCE_SIGNUP_APPROVAL === 'true';
  const hardBlockShell = enforceGate && !approved;

  return { approved, signupRejected: false, hardBlockShell };
}
