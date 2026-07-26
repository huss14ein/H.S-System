/**
 * Append-only revisions of the daily net-worth snapshot.
 *
 * `net_worth_snapshots` keeps one row per calendar day (upsert). When a reconciliation adjustment
 * restates a day that was already captured, we append a revision here instead of losing the prior
 * value, so the audit trail can answer "what did net worth look like before the correction?".
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NetWorthSnapshotRevisionBuckets {
  cash: number;
  investments: number;
  physicalAndCommodities: number;
  receivables: number;
  liabilities: number;
  sukukSar?: number;
  /** Rewards/points memo bucket (SAR) — absent on pre-rewards revisions. */
  rewards?: number;
}

export interface NetWorthSnapshotRevision {
  id: string;
  snapshotDay: string;
  capturedAt: string;
  netWorth: number;
  buckets?: NetWorthSnapshotRevisionBuckets | null;
  sarPerUsd?: number | null;
  supersededByAdjustmentId?: string | null;
  runId?: string | null;
  revision: number;
  metadata?: Record<string, unknown>;
}

export interface NetWorthSnapshotRevisionInput {
  snapshotDay: string;
  netWorth: number;
  buckets?: NetWorthSnapshotRevisionBuckets | null;
  sarPerUsd?: number | null;
  supersededByAdjustmentId?: string | null;
  runId?: string | null;
  metadata?: Record<string, unknown>;
}

export function normalizeNetWorthSnapshotRevisionRow(row: Record<string, unknown>): NetWorthSnapshotRevision {
  const rawBuckets = row.buckets as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    snapshotDay: String(row.snapshot_day ?? row.snapshotDay ?? '').slice(0, 10),
    capturedAt: String(row.captured_at ?? row.capturedAt ?? new Date().toISOString()),
    netWorth: Number(row.net_worth ?? row.netWorth ?? 0),
    buckets: rawBuckets
      ? {
          cash: Number(rawBuckets.cash) || 0,
          investments: Number(rawBuckets.investments) || 0,
          physicalAndCommodities: Number(rawBuckets.physicalAndCommodities) || 0,
          receivables: Number(rawBuckets.receivables) || 0,
          liabilities: Number(rawBuckets.liabilities) || 0,
          sukukSar:
            rawBuckets.sukukSar != null && Number.isFinite(Number(rawBuckets.sukukSar))
              ? Number(rawBuckets.sukukSar)
              : undefined,
          rewards:
            rawBuckets.rewards != null && Number.isFinite(Number(rawBuckets.rewards))
              ? Number(rawBuckets.rewards)
              : undefined,
        }
      : null,
    sarPerUsd:
      row.sar_per_usd != null && Number.isFinite(Number(row.sar_per_usd)) ? Number(row.sar_per_usd) : null,
    supersededByAdjustmentId: (row.superseded_by_adjustment_id ?? row.supersededByAdjustmentId) as
      | string
      | null
      | undefined,
    runId: (row.run_id ?? row.runId) as string | null | undefined,
    revision: Number(row.revision ?? 1) || 1,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/** Next revision number for a day (1 when nothing recorded yet). */
export async function nextSnapshotRevisionNumber(
  db: SupabaseClient,
  userId: string,
  snapshotDay: string,
): Promise<number> {
  const { data, error } = await db
    .from('net_worth_snapshot_revisions')
    .select('revision')
    .eq('user_id', userId)
    .eq('snapshot_day', snapshotDay)
    .order('revision', { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return 1;
  return (Number((data[0] as { revision?: number }).revision) || 0) + 1;
}

/**
 * Append a revision. Missing table (migration not applied) is treated as a soft skip so client
 * apply keeps working.
 */
export async function insertNetWorthSnapshotRevision(
  db: SupabaseClient,
  userId: string,
  input: NetWorthSnapshotRevisionInput,
): Promise<{ data: NetWorthSnapshotRevision | null; error: { message: string } | null }> {
  const snapshotDay = String(input.snapshotDay || '').slice(0, 10);
  if (!snapshotDay) return { data: null, error: { message: 'snapshotDay is required' } };
  const revision = await nextSnapshotRevisionNumber(db, userId, snapshotDay);
  const { data, error } = await db
    .from('net_worth_snapshot_revisions')
    .insert({
      user_id: userId,
      snapshot_day: snapshotDay,
      net_worth: Number(input.netWorth) || 0,
      buckets: input.buckets ?? null,
      sar_per_usd: input.sarPerUsd ?? null,
      superseded_by_adjustment_id: input.supersededByAdjustmentId ?? null,
      run_id: input.runId ?? null,
      revision,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .maybeSingle();
  if (error) return { data: null, error: { message: error.message } };
  return {
    data: data ? normalizeNetWorthSnapshotRevisionRow(data as Record<string, unknown>) : null,
    error: null,
  };
}

/** Latest revision per calendar day, newest day first. */
export async function fetchLatestNetWorthSnapshotRevisions(
  db: SupabaseClient,
  userId: string,
  limit = 400,
): Promise<NetWorthSnapshotRevision[]> {
  const { data, error } = await db
    .from('net_worth_snapshot_revisions')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_day', { ascending: false })
    .order('revision', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return latestRevisionPerDay((data as Record<string, unknown>[]).map(normalizeNetWorthSnapshotRevisionRow));
}

/** Keep the highest revision for each day (input may be unsorted). */
export function latestRevisionPerDay(rows: NetWorthSnapshotRevision[]): NetWorthSnapshotRevision[] {
  const byDay = new Map<string, NetWorthSnapshotRevision>();
  for (const row of rows) {
    const prev = byDay.get(row.snapshotDay);
    if (!prev || row.revision > prev.revision) byDay.set(row.snapshotDay, row);
  }
  return Array.from(byDay.values()).sort((a, b) => (a.snapshotDay < b.snapshotDay ? 1 : -1));
}
