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
 * Whether the SPA should block unapproved signups at the shell.
 * Production defaults to enforced; set VITE_ENFORCE_SIGNUP_APPROVAL=false to disable.
 */
export function isSignupApprovalEnforced(): boolean {
  const flag = import.meta.env.VITE_ENFORCE_SIGNUP_APPROVAL;
  if (import.meta.env.DEV) {
    return flag === 'true';
  }
  return flag !== 'false';
}

export type EffectiveAppAccess = {
  approved: boolean;
  signupRejected: boolean;
  /** True → show pending / rejected shell instead of the main app. */
  hardBlockShell: boolean;
};

/**
 * Shell access from `public.users` (via ensure_own_user_profile). Does not trust client-only signals
 * like email_confirmed_at — those bypass admin approval for new signups. Real data access still
 * relies on Supabase RLS (auth.uid()).
 */
export function resolveEffectiveAppAccess(
  row: Record<string, unknown> | null,
  authUser: User | null,
): EffectiveAppAccess {
  const flags = approvalFlagsFromUserRow(row);
  if (flags?.signupRejected) {
    return { approved: false, signupRejected: true, hardBlockShell: true };
  }

  const dbRole = row ? String(row.role ?? '').trim() : null;
  const approved = Boolean(flags?.approved) || inferIsAdmin(authUser, dbRole);
  const hardBlockShell = isSignupApprovalEnforced() && !approved;

  return { approved, signupRejected: false, hardBlockShell };
}
