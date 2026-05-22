import type { PlannedTrade } from '../types';

export type DateLike = string | number | Date | null | undefined;

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
  date?: string;
  transaction_date?: string;
  created_at?: string;
  createdAt?: string;
  timestamp?: string | number;
  at?: string;
  uploadedAt?: Date | string;
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

/** Return a copy sorted newest → oldest using common date field names. */
export function sortByNewestFirst<T extends RecencyDateFields>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => pickItemTimestamp(b) - pickItemTimestamp(a));
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
