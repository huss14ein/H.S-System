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
