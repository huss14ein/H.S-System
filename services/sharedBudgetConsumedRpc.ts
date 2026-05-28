import { supabase } from './supabaseClient';
import { logSharedBudgetRpcFailureOnce } from './sharedBudgetRpcLog';
import {
  makeSharedOwnerCategoryKey,
  normalizeSharedCategoryKey,
  normalizeSharedOwnerKey,
} from './sharedBudgetKeys';

function ingestRows(map: Map<string, number>, rows: any[] | null): void {
  (rows ?? []).forEach((row: any) => {
    const ownerKey = normalizeSharedOwnerKey(row.owner_user_id || 'owner');
    const category = normalizeSharedCategoryKey(row.category || '');
    if (!category) return;
    map.set(makeSharedOwnerCategoryKey(ownerKey, category), Number(row.consumed_amount) || 0);
  });
}

async function fetchSharedConsumedMapOnce(
  client: NonNullable<typeof supabase>,
  args: Record<string, unknown>,
): Promise<{ map: Map<string, number>; rpcFailed: boolean }> {
  const map = new Map<string, number>();
  try {
    const scoped = await client.rpc('get_shared_budget_consumed_for_me', args);
    if (!scoped.error) {
      ingestRows(map, (scoped.data as any[]) ?? []);
      return { map, rpcFailed: false };
    }
    logSharedBudgetRpcFailureOnce(scoped.error);
    return { map, rpcFailed: true };
  } catch (err) {
    logSharedBudgetRpcFailureOnce(err);
    return { map, rpcFailed: true };
  }
}

/** Shared budget consumed RPC with a single delayed retry on failure. */
export async function fetchSharedConsumedMap(
  client: NonNullable<typeof supabase>,
  args: Record<string, unknown>,
): Promise<{ map: Map<string, number>; rpcFailed: boolean }> {
  const first = await fetchSharedConsumedMapOnce(client, args);
  if (!first.rpcFailed) return first;
  await new Promise((r) => setTimeout(r, 500));
  return fetchSharedConsumedMapOnce(client, args);
}
