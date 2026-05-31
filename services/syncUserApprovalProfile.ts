import type { SupabaseClient, User } from '@supabase/supabase-js';
import { approvalFlagsFromUserRow } from '../utils/userApproval';
import { inferIsAdmin } from '../utils/role';

const RETRY_DELAYS_MS = [0, 400, 1200];

export type SyncUserApprovalResult = {
  row: Record<string, unknown> | null;
  /** When true, caller should treat the user as approved (network/legacy bootstrap). */
  failOpenApproved: boolean;
};

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/** Refresh session so mobile Safari resumes with a valid access token before RLS reads. */
async function refreshSessionIfPossible(client: SupabaseClient): Promise<void> {
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    const expiresAt = Number((session as { expires_at?: number }).expires_at ?? 0);
    const expiresMs = expiresAt > 0 ? expiresAt * 1000 : 0;
    const soon = expiresMs > 0 && expiresMs - Date.now() < 5 * 60 * 1000;
    if (soon) {
      await client.auth.refreshSession();
    }
  } catch {
    /* non-fatal */
  }
}

async function callEnsureOwnUserProfile(
  client: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.rpc('ensure_own_user_profile').maybeSingle();
  if (error) return null;
  return (data as Record<string, unknown> | null) ?? null;
}

async function readUsersRow(
  client: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.from('users').select().eq('id', userId).maybeSingle();
  if (error) return null;
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Resolve `public.users` for the signed-in user. Prefer `ensure_own_user_profile` (bootstrap + admin auto-approve).
 * Retries help mobile Safari after cold start or flaky networks.
 */
export async function syncUserApprovalProfile(
  client: SupabaseClient,
  userId: string,
  authUser: User | null,
): Promise<SyncUserApprovalResult> {
  await refreshSessionIfPossible(client);

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    await sleep(RETRY_DELAYS_MS[i] ?? 0);
    const ensured = await callEnsureOwnUserProfile(client);
    if (ensured) {
      return { row: ensured, failOpenApproved: false };
    }
  }

  const fromTable = await readUsersRow(client, userId);
  if (fromTable) {
    return { row: fromTable, failOpenApproved: false };
  }

  if (inferIsAdmin(authUser, null)) {
    return { row: null, failOpenApproved: true };
  }

  return { row: null, failOpenApproved: false };
}

/** Apply sync result to access flags (Admin role always approved). */
export function approvalFlagsFromSync(
  row: Record<string, unknown> | null,
  failOpenApproved: boolean,
): { approved: boolean; signupRejected: boolean } {
  const flags = approvalFlagsFromUserRow(row);
  if (flags) return { approved: flags.approved, signupRejected: flags.signupRejected };
  return { approved: failOpenApproved, signupRejected: false };
}
