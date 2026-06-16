import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedSupabaseRpc, invalidateSupabaseQueryCache } from './supabaseQueryCache';

export type SharedAccountRpcRow = {
  account_id?: string;
  id?: string;
  name?: string;
  type?: string;
  balance?: number;
  owner?: string;
  owner_email?: string;
  ownerEmail?: string;
  owner_user_id?: string;
  user_id?: string;
  show_balance?: boolean;
};

/** Single cached path for `get_shared_accounts_for_me` (Accounts + Transactions). */
export async function fetchSharedAccountsForMe(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: SharedAccountRpcRow[]; error: unknown }> {
  const key = `rpc:shared-accounts:${userId}`;
  const res = await cachedSupabaseRpc<SharedAccountRpcRow[] | null>(
    key,
    async () => {
      const result = await client.rpc('get_shared_accounts_for_me');
      return { data: (result.data as SharedAccountRpcRow[] | null) ?? null, error: result.error };
    },
  );
  return { data: res.data ?? [], error: res.error };
}

export function invalidateSharedAccountsCache(userId?: string): void {
  if (userId) invalidateSupabaseQueryCache(`rpc:shared-accounts:${userId}`);
}
