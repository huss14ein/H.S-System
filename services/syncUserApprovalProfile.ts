import type { SupabaseClient, User } from '@supabase/supabase-js';
import { approvalFlagsFromUserRow, resolveEffectiveAppAccess } from '../utils/userApproval';

/** Mobile Safari cold starts need more retries than desktop. */
const RETRY_DELAYS_MS = [0, 300, 800, 2000, 4000, 8000];

export type SyncUserApprovalResult = {
  row: Record<string, unknown> | null;
  /** Set when ensure_own_user_profile is missing (run DB migrations). */
  rpcMissing: boolean;
  /** Set when all retries failed without a profile row (transient network). */
  networkFailed: boolean;
};

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/** Refresh session before RLS reads — mobile often resumes with a stale access token. */
async function refreshSessionForProfileSync(client: SupabaseClient): Promise<void> {
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    await client.auth.refreshSession();
  } catch {
    /* non-fatal */
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
      (/ensure_own_user_profile/.test(msg) && /does not exist|not found|could not find/i.test(msg));
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

function rowIsTerminal(row: Record<string, unknown>): boolean {
  const flags = approvalFlagsFromUserRow(row);
  return Boolean(flags && (flags.approved || flags.signupRejected));
}

/**
 * Resolve `public.users` for the signed-in user. Server RPC `ensure_own_user_profile` is the
 * source of truth (auto-approves Admin / single-tenant / verified email per migrations).
 */
export async function syncUserApprovalProfile(
  client: SupabaseClient,
  userId: string,
): Promise<SyncUserApprovalResult> {
  await refreshSessionForProfileSync(client);

  let rpcMissing = false;
  let lastEnsuredRow: Record<string, unknown> | null = null;

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    await sleep(RETRY_DELAYS_MS[i] ?? 0);
    if (i > 0) {
      await refreshSessionForProfileSync(client);
    }
    const { row, rpcMissing: missing } = await callEnsureOwnUserProfile(client);
    rpcMissing = rpcMissing || missing;
    if (row) {
      lastEnsuredRow = row;
      if (rowIsTerminal(row)) {
        return { row, rpcMissing, networkFailed: false };
      }
    }
  }

  if (lastEnsuredRow) {
    return { row: lastEnsuredRow, rpcMissing, networkFailed: false };
  }

  const fromTable = await readUsersRow(client, userId);
  if (fromTable) {
    return { row: fromTable, rpcMissing, networkFailed: false };
  }

  return { row: null, rpcMissing, networkFailed: !rpcMissing };
}

/** Map sync result → shell access flags (no client-side approval bypass). */
export function approvalFlagsFromSync(
  row: Record<string, unknown> | null,
  authUser: User | null,
): ReturnType<typeof resolveEffectiveAppAccess> {
  return resolveEffectiveAppAccess(row, authUser);
}
