import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedSupabaseRpc, invalidateSupabaseQueryCache } from './supabaseQueryCache';

export async function fetchPendingTransactionsForAdmin(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: unknown[] | null; error: unknown }> {
  const key = `rpc:pending-tx-admin:${userId}`;
  return cachedSupabaseRpc<unknown[] | null>(
    key,
    async () => {
      const result = await client.rpc('get_pending_transactions_for_admin');
      return { data: (result.data as unknown[] | null) ?? null, error: result.error };
    },
    20_000,
  );
}

export function invalidatePendingTransactionsCache(userId?: string): void {
  if (userId) invalidateSupabaseQueryCache(`rpc:pending-tx-admin:${userId}`);
}
