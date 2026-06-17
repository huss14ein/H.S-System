import type { SupabaseClient, User } from '@supabase/supabase-js';
import { approvalFlagsFromUserRow, resolveEffectiveAppAccess } from '../utils/userApproval';

/** Mobile Safari cold starts need more retries than desktop. */
const RETRY_DELAYS_MS = [0, 300, 800, 2000, 4000, 8000];
const PROFILE_CACHE_MS = 120_000;

let profileCache: { userId: string; at: number; result: SyncUserApprovalResult } | null = null;

export function invalidateUserApprovalProfileCache(userId?: string): void {
  if (!userId || profileCache?.userId === userId) profileCache = null;
}

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

/** Skip refresh immediately after sign-in — refresh inside onAuthStateChange can emit SIGNED_OUT. */
let lastAuthSignInAtMs = 0;

export function markAuthSignInForProfileSync(): void {
  lastAuthSignInAtMs = Date.now();
}

/** Refresh only when the access token is near expiry (never on every profile read). */
async function refreshSessionForProfileSync(client: SupabaseClient): Promise<void> {
  if (Date.now() - lastAuthSignInAtMs < 4000) return;
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    const expiresAt = Number(session.expires_at ?? 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt > 0 && expiresAt - nowSec > 120) return;
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
  const cached = profileCache;
  if (cached && cached.userId === userId && Date.now() - cached.at < PROFILE_CACHE_MS) {
    return cached.result;
  }

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
        const result = { row, rpcMissing, networkFailed: false };
        profileCache = { userId, at: Date.now(), result };
        return result;
      }
    }
  }

  if (lastEnsuredRow) {
    if (!rowIsTerminal(lastEnsuredRow)) {
      await sleep(400);
      await refreshSessionForProfileSync(client);
      const retry = await callEnsureOwnUserProfile(client);
      if (retry.row && rowIsTerminal(retry.row)) {
        const result = { row: retry.row, rpcMissing, networkFailed: false };
        profileCache = { userId, at: Date.now(), result };
        return result;
      }
      if (retry.row) lastEnsuredRow = retry.row;
    }
    const result = { row: lastEnsuredRow, rpcMissing, networkFailed: false };
    profileCache = { userId, at: Date.now(), result };
    return result;
  }

  const fromTable = await readUsersRow(client, userId);
  if (fromTable) {
    const result = { row: fromTable, rpcMissing, networkFailed: false };
    profileCache = { userId, at: Date.now(), result };
    return result;
  }

  const failed = { row: null, rpcMissing, networkFailed: !rpcMissing };
  return failed;
}

/** Map sync result → shell access flags (no client-side approval bypass). */
export function approvalFlagsFromSync(
  row: Record<string, unknown> | null,
  authUser: User | null,
): ReturnType<typeof resolveEffectiveAppAccess> {
  return resolveEffectiveAppAccess(row, authUser);
}
