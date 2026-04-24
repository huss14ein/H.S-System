import type { SupabaseClient } from '@supabase/supabase-js';
import { recordSarPerUsdForCalendarDay } from './fxDailySeries';

const KEY = 'finova_nw_snapshots_v1';
/** One-time localStorage backfill: stamp legacy rows that predate explicit bucket schema versioning. */
const SCHEMA_BACKFILL_KEY = 'finova_nw_buckets_schema_backfill_v1';
/** ~6 years of monthly points at one snapshot per month (cap prevents unbounded localStorage growth). */
const MAX = 72;

/** Legacy stored buckets: Sukuk under Assets was included in `physicalAndCommodities`. */
export const NW_BUCKETS_SCHEMA_LEGACY = 1;
/** Current: Sukuk under Assets is included in `investments`; optional `sukukSar` on buckets for audit. */
export const NW_BUCKETS_SCHEMA_V2 = 2;

export interface NetWorthSnapshot {
  at: string;
  netWorth: number;
  /** SAR per 1 USD at capture — feeds historical FX series for charts/KPIs. */
  sarPerUsd?: number;
  /**
   * How `buckets` were classified. Absent on old rows → treated as {@link NW_BUCKETS_SCHEMA_LEGACY} when `buckets` exists.
   */
  bucketsSchemaVersion?: number;
  buckets?: {
    cash: number;
    investments: number;
    physicalAndCommodities: number;
    receivables: number;
    liabilities: number;
    /** SAR — optional audit trail (schema v2+). */
    sukukSar?: number;
  };
}

function normalizeSnapshotRead(s: NetWorthSnapshot): NetWorthSnapshot {
  return {
    ...s,
    bucketsSchemaVersion: s.bucketsSchemaVersion ?? (s.buckets ? NW_BUCKETS_SCHEMA_LEGACY : undefined),
  };
}

export type NetWorthSyncContext = {
  supabase: SupabaseClient;
  userId: string;
};

function snapshotDayFromAt(iso: string): string {
  return iso.slice(0, 10);
}

/** Upsert one snapshot row (one row per user per calendar day). */
export async function upsertNetWorthSnapshotServer(
  client: SupabaseClient,
  userId: string,
  snap: NetWorthSnapshot,
): Promise<void> {
  const day = snapshotDayFromAt(snap.at);
  const { error } = await client.from('net_worth_snapshots').upsert(
    {
      user_id: userId,
      snapshot_day: day,
      captured_at: snap.at,
      net_worth: snap.netWorth,
      buckets: snap.buckets ?? null,
      sar_per_usd: snap.sarPerUsd ?? null,
    },
    { onConflict: 'user_id,snapshot_day' },
  );
  if (error) console.warn('net_worth_snapshots upsert:', error.message);
}

function serverRowToSnapshot(row: {
  snapshot_day: string;
  captured_at: string;
  net_worth: number;
  buckets?: unknown;
  sar_per_usd?: number | null;
}): NetWorthSnapshot {
  const raw = row.buckets as (NetWorthSnapshot['buckets'] & { _schema?: number }) | null | undefined;
  const schemaFromJson = raw && typeof (raw as { _schema?: unknown })._schema === 'number' ? (raw as { _schema: number })._schema : undefined;
  const buckets =
    raw == null
      ? undefined
      : {
          cash: Number(raw.cash) || 0,
          investments: Number(raw.investments) || 0,
          physicalAndCommodities: Number(raw.physicalAndCommodities) || 0,
          receivables: Number(raw.receivables) || 0,
          liabilities: Number(raw.liabilities) || 0,
          sukukSar: raw.sukukSar != null && Number.isFinite(Number(raw.sukukSar)) ? Number(raw.sukukSar) : undefined,
        };
  return normalizeSnapshotRead({
    at: row.captured_at || `${row.snapshot_day}T12:00:00.000Z`,
    netWorth: Number(row.net_worth),
    sarPerUsd: row.sar_per_usd != null && Number.isFinite(Number(row.sar_per_usd)) ? Number(row.sar_per_usd) : undefined,
    buckets,
    bucketsSchemaVersion: schemaFromJson,
  });
}

function mergeSnapshotsByDay(snapshots: NetWorthSnapshot[]): NetWorthSnapshot[] {
  const byDay = new Map<string, NetWorthSnapshot>();
  for (const s of snapshots) {
    const day = snapshotDayFromAt(s.at);
    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, s);
      continue;
    }
    const tNew = new Date(s.at).getTime();
    const tPrev = new Date(prev.at).getTime();
    if (tNew >= tPrev) byDay.set(day, s);
  }
  return Array.from(byDay.values()).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** Pull server history and merge into localStorage (dedupe by day, keep latest capture). */
export async function mergeNetWorthSnapshotsFromServer(client: SupabaseClient, userId: string): Promise<void> {
  try {
    const local = listNetWorthSnapshots();
    const { data, error } = await client
      .from('net_worth_snapshots')
      .select('snapshot_day,captured_at,net_worth,buckets,sar_per_usd')
      .eq('user_id', userId)
      .order('captured_at', { ascending: false })
      .limit(500);
    if (error || !data?.length) return;
    const remote = (data as any[]).map((row) => serverRowToSnapshot(row));
    const merged = mergeSnapshotsByDay([...local, ...remote]);
    localStorage.setItem(KEY, JSON.stringify(merged.slice(0, MAX)));
  } catch (e) {
    console.warn('mergeNetWorthSnapshotsFromServer:', e);
  }
}

export function pushNetWorthSnapshot(
  netWorth: number,
  buckets?: NetWorthSnapshot['buckets'],
  sarPerUsd?: number,
  sync?: NetWorthSyncContext | null,
): void {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: NetWorthSnapshot[] = raw ? JSON.parse(raw) : [];
    const last = arr[0];
    const today = new Date().toISOString().slice(0, 10);
    const at = new Date().toISOString();
    const fx = typeof sarPerUsd === 'number' && Number.isFinite(sarPerUsd) && sarPerUsd > 0 ? sarPerUsd : undefined;
    if (fx != null) recordSarPerUsdForCalendarDay(today, fx);
    const schemaForRow = buckets ? NW_BUCKETS_SCHEMA_V2 : last?.bucketsSchemaVersion;
    let final: NetWorthSnapshot;
    if (last && last.at.slice(0, 10) === today) {
      final = { at, netWorth, sarPerUsd: fx ?? last.sarPerUsd, buckets: buckets ?? last.buckets, bucketsSchemaVersion: buckets ? NW_BUCKETS_SCHEMA_V2 : schemaForRow };
      arr[0] = final;
    } else {
      final = { at, netWorth, sarPerUsd: fx, buckets, bucketsSchemaVersion: buckets ? NW_BUCKETS_SCHEMA_V2 : undefined };
      arr.unshift(final);
    }
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX)));
    if (sync?.supabase && sync.userId) {
      void upsertNetWorthSnapshotServer(sync.supabase, sync.userId, final);
    }
  } catch {}
}

export function listNetWorthSnapshots(): NetWorthSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    let arr: NetWorthSnapshot[] = raw ? JSON.parse(raw) : [];

    const needsPersistedBackfill =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(SCHEMA_BACKFILL_KEY) !== 'done' &&
      arr.some((s) => s.buckets != null && s.bucketsSchemaVersion === undefined);

    if (needsPersistedBackfill) {
      arr = arr.map((s) =>
        s.buckets && s.bucketsSchemaVersion === undefined
          ? { ...s, bucketsSchemaVersion: NW_BUCKETS_SCHEMA_LEGACY }
          : normalizeSnapshotRead(s),
      );
      localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX)));
      localStorage.setItem(SCHEMA_BACKFILL_KEY, 'done');
    }

    return arr.map(normalizeSnapshotRead);
  } catch {
    return [];
  }
}

/** Create a snapshot (e.g. month-end); same as pushNetWorthSnapshot. */
export function createMonthlySnapshot(
  netWorth: number,
  buckets?: NetWorthSnapshot['buckets'],
  sarPerUsd?: number,
  sync?: NetWorthSyncContext | null,
): void {
  pushNetWorthSnapshot(netWorth, buckets, sarPerUsd, sync);
}

/** Compare two snapshots by date; returns NW change. */
export function compareSnapshots(
  snapshots: NetWorthSnapshot[],
  fromDate: string,
  toDate: string
): { fromNw: number; toNw: number; change: number } | null {
  const from = snapshots.find((s) => s.at.slice(0, 10) === fromDate.slice(0, 10));
  const to = snapshots.find((s) => s.at.slice(0, 10) === toDate.slice(0, 10));
  if (!from || !to) return null;
  return { fromNw: from.netWorth, toNw: to.netWorth, change: to.netWorth - from.netWorth };
}

/** Restore historical view: return snapshot closest to date. */
export function restoreHistoricalView(snapshots: NetWorthSnapshot[], date: string): NetWorthSnapshot | null {
  const target = new Date(date).getTime();
  let best: NetWorthSnapshot | null = null;
  let bestDiff = Infinity;
  snapshots.forEach((s) => {
    const d = new Date(s.at).getTime();
    const diff = Math.abs(d - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  });
  return best;
}

const LOCK_KEY = 'finova_nw_month_lock_v1';

/** Mark a month as locked (no more edits to that month's snapshot). */
export function lockMonthEnd(yearMonth: string): void {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(yearMonth)) set.push(yearMonth);
    localStorage.setItem(LOCK_KEY, JSON.stringify(set));
  } catch {}
}

/** Check if a month is locked. */
export function isMonthLocked(yearMonth: string): boolean {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const set: string[] = raw ? JSON.parse(raw) : [];
    return set.includes(yearMonth);
  } catch {
    return false;
  }
}
