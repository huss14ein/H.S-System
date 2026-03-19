const KEY = 'finova_nw_snapshots_v1';
const MAX = 36;

export interface NetWorthSnapshot {
  at: string;
  netWorth: number;
}

export function pushNetWorthSnapshot(netWorth: number): void {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: NetWorthSnapshot[] = raw ? JSON.parse(raw) : [];
    const last = arr[0];
    const today = new Date().toISOString().slice(0, 10);
    if (last && last.at.slice(0, 10) === today) {
      arr[0] = { at: new Date().toISOString(), netWorth };
    } else {
      arr.unshift({ at: new Date().toISOString(), netWorth });
    }
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX)));
  } catch {}
}

export function listNetWorthSnapshots(): NetWorthSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Create a snapshot (e.g. month-end); same as pushNetWorthSnapshot. */
export function createMonthlySnapshot(netWorth: number): void {
  pushNetWorthSnapshot(netWorth);
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
