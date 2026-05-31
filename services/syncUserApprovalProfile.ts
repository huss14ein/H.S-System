import type { SupabaseClient, User } from '@supabase/supabase-js';
import { approvalFlagsFromUserRow } from '../utils/userApproval';
import { inferIsAdmin } from '../utils/role';

/** Mobile Safari cold starts need more retries than desktop. */
const RETRY_DELAYS_MS = [0, 300, 800, 2000, 4000];

export type SyncUserApprovalResult = {
  row: Record<string, unknown> | null;
  /** When true, caller should treat the user as approved (network/legacy bootstrap). */
  failOpenApproved: boolean;
};

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/** Always refresh session before RLS reads — mobile often resumes with a stale access token. */
async function refreshSessionForProfileSync(client: SupabaseClient): Promise<void> {
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    await client.auth.refreshSession();
  } catch {
    /* non-fatal — ensure_own_user_profile may still succeed */
  }
}

async function callEnsureOwnUserProfile(
  client: SupabaseClient,
): Promise<{ row: Record<string, unknown> | null; rpcMissing: boolean }> {
  const { data, error } = await client.rpc('ensure_own_user_profile').maybeSingle();
  if (error) {
    const msg = `${error.message ?? ''} ${error.code ?? ''}`.toLowerCase();
    const rpcMissing =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      /ensure_own_user_profile/.test(msg) && /does not exist|not found|could not find/i.test(msg);
    return { row: null, rpcMissing };
  }
  return { row: (data as Record<string, unknown> | null) ?? null, rpcMissing: false };
}

async function readUsersRow(
  client: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.from('users').select().eq('id', userId).maybeSingle();
  if (error) return null;
  return (data as Record<string, unknown> | null) ?? null;
}

function rowGrantsAccess(row: Record<string, unknown> | null): boolean {
  const flags = approvalFlagsFromUserRow(row);
  return Boolean(flags?.approved);
}

/**
 * Resolve `public.users` for the signed-in user. `ensure_own_user_profile` is the source of truth
 * (bootstrap + admin auto-approve). Never trust a stale approved=false row without running ensure first.
 */
export async function syncUserApprovalProfile(
  client: SupabaseClient,
  userId: string,
  authUser: User | null,
): Promise<SyncUserApprovalResult> {
  await refreshSessionForProfileSync(client);

  let rpcMissing = false;

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    await sleep(RETRY_DELAYS_MS[i] ?? 0);
    if (i > 0) {
      await refreshSessionForProfileSync(client);
    }
    const { row, rpcMissing: missing } = await callEnsureOwnUserProfile(client);
    rpcMissing = rpcMissing || missing;
    if (row && rowGrantsAccess(row)) {
      return { row, failOpenApproved: false };
    }
    if (row) {
      // ensure ran but still pending (genuine Restricted signup awaiting admin).
      return { row, failOpenApproved: false };
    }
  }

  const fromTable = await readUsersRow(client, userId);
  if (fromTable && rowGrantsAccess(fromTable)) {
    return { row: fromTable, failOpenApproved: false };
  }
  if (fromTable) {
    return { row: fromTable, failOpenApproved: false };
  }

  // RPC not deployed yet or transient network failure — do not lock out verified owner sessions.
  if (rpcMissing || inferIsAdmin(authUser, null)) {
    return { row: null, failOpenApproved: true };
  }
  if (authUser?.email_confirmed_at) {
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
