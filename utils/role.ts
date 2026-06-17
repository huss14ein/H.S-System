import type { User } from '@supabase/supabase-js';

/**
 * Role helpers for admin checks — DB role only (never JWT user_metadata).
 */
export function inferIsAdmin(_user: User | null | undefined, dbRole?: string | null): boolean {
  const role = String(dbRole || '').trim().toLowerCase();
  return role === 'admin';
}
