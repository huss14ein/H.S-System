import type { User } from '@supabase/supabase-js';

/**
 * Role helpers for admin checks.
 */
export function inferIsAdmin(user: User | null | undefined, dbRole?: string | null): boolean {
  if (String(dbRole || '').trim().toLowerCase() === 'admin') return true;
  if (dbRole === 'Admin') return true;
  const appRole = user?.app_metadata && typeof user.app_metadata === 'object' ? (user.app_metadata as any).role : undefined;
  const userRole = user?.user_metadata && typeof user.user_metadata === 'object' ? (user.user_metadata as any).role : undefined;
  const role = String(appRole ?? userRole ?? '').trim().toLowerCase();
  return role === 'admin';
}
