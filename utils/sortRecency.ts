import type { PlannedTrade } from '../types';

export type DateLike = string | number | Date | null | undefined;

/** Minutes since midnight from `sms:time=HH:mm` in a note; -1 when absent. */
function smsTimeMinutesFromNote(note: string | undefined): number {
  const m = String(note || '').match(/sms:time=(\d{1,2}):(\d{2})\b/i);
  if (!m) return -1;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return -1;
  return hh * 60 + mm;
}

/** Parse a date-like value to epoch ms; invalid → 0. */
export function timestampFromDateLike(value: DateLike): number {
  if (value == null || value === '') return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest first (descending). */
export function compareByDateDesc(aDate: DateLike, bDate: DateLike): number {
  return timestampFromDateLike(bDate) - timestampFromDateLike(aDate);
}

export type RecencyDateFields = {
  id?: string;
  date?: string;
  transaction_date?: string;
  created_at?: string;
  createdAt?: string;
  timestamp?: string | number;
  at?: string;
  uploadedAt?: Date | string;
  note?: string;
};

export function pickItemTimestamp(item: RecencyDateFields): number {
  return timestampFromDateLike(
    item.date ??
      item.transaction_date ??
      item.created_at ??
      item.createdAt ??
      item.timestamp ??
      item.at ??
      item.uploadedAt,
  );
}

/** Secondary recency for same calendar date: SMS clock → created_at / createdAt → id. */
function pickTieBreakTimestamp(item: RecencyDateFields): number {
  return timestampFromDateLike(item.created_at ?? item.createdAt);
}

function compareRecencyNewestFirst(a: RecencyDateFields, b: RecencyDateFields): number {
  const primary = pickItemTimestamp(b) - pickItemTimestamp(a);
  if (primary !== 0) return primary;
  const smsTime = smsTimeMinutesFromNote(b.note) - smsTimeMinutesFromNote(a.note);
  if (smsTime !== 0) return smsTime;
  const secondary = pickTieBreakTimestamp(b) - pickTieBreakTimestamp(a);
  if (secondary !== 0) return secondary;
  return String(b.id ?? '').localeCompare(String(a.id ?? ''), undefined, { sensitivity: 'base' });
}

/** Return a copy sorted newest → oldest using common date field names. */
export function sortByNewestFirst<T extends RecencyDateFields>(items: readonly T[]): T[] {
  return [...items].sort(compareRecencyNewestFirst);
}

const PLAN_PRIORITY_RANK: Record<PlannedTrade['priority'], number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

/** Planned trades: active before executed; date triggers by later target; price by priority. */
export function comparePlannedTradesNewestFirst(a: PlannedTrade, b: PlannedTrade): number {
  if (a.status !== b.status) return a.status === 'Executed' ? 1 : -1;
  if (a.conditionType === 'date' && b.conditionType === 'date') {
    return (b.targetValue ?? 0) - (a.targetValue ?? 0);
  }
  if (a.conditionType === 'date') return -1;
  if (b.conditionType === 'date') return 1;
  const pr =
    (PLAN_PRIORITY_RANK[b.priority] ?? 0) - (PLAN_PRIORITY_RANK[a.priority] ?? 0);
  if (pr !== 0) return pr;
  return (b.symbol ?? '').localeCompare(a.symbol ?? '', undefined, { sensitivity: 'base' });
}

export function sortPlannedTradesNewestFirst(items: readonly PlannedTrade[]): PlannedTrade[] {
  return [...items].sort(comparePlannedTradesNewestFirst);
}
