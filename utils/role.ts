/**
 * Role helpers for admin checks.
 */

export function inferIsAdmin(
  _user: { id?: string; email?: string } | null,
  role: string | null | undefined
): boolean {
  return role === 'Admin';
}
