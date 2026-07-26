/**
 * Period locks (closed accounting months). Durable server SOT lives in `data.periodLocks`
 * (table `period_locks`); a legacy localStorage set remains as a per-device fallback.
 *
 * Precedence: server list (`data.periodLocks`) → module server cache → localStorage
 * (all combined via {@link isMonthLocked} in `netWorthSnapshot`).
 */
import type { FinancialData, PeriodLock } from '../types';
import { isMonthLocked, setServerPeriodLocks } from './netWorthSnapshot';

export { setServerPeriodLocks };

export function normalizeYearMonth(input: string): string {
  return String(input ?? '').slice(0, 7);
}

/** True when the given YYYY-MM is locked according to the server list (preferred) or fallbacks. */
export function isPeriodLocked(
  data: Pick<FinancialData, 'periodLocks'> | null | undefined,
  yearMonth: string,
): boolean {
  const ym = normalizeYearMonth(yearMonth);
  const fromDb = (data?.periodLocks ?? []).some((l) => normalizeYearMonth(l.yearMonth) === ym);
  if (fromDb) return true;
  return isMonthLocked(ym);
}

/** Sorted list of locked YYYY-MM keys from the server list. */
export function listLockedMonths(
  data: Pick<FinancialData, 'periodLocks'> | null | undefined,
): string[] {
  return Array.from(new Set((data?.periodLocks ?? []).map((l) => normalizeYearMonth(l.yearMonth))))
    .filter(Boolean)
    .sort();
}

/** Build an insert row for the `period_locks` table. */
export function periodLockToRow(lock: Omit<PeriodLock, 'id'> & { id?: string }, userId: string): Record<string, unknown> {
  return {
    ...(lock.id ? { id: lock.id } : {}),
    user_id: userId,
    year_month: normalizeYearMonth(lock.yearMonth),
    locked_at: lock.lockedAt ?? new Date().toISOString(),
    reason: lock.reason ?? null,
  };
}

export function normalizePeriodLockRow(row: Record<string, unknown>): PeriodLock {
  return {
    id: String(row.id ?? ''),
    yearMonth: normalizeYearMonth(String(row.year_month ?? (row as { yearMonth?: string }).yearMonth ?? '')),
    lockedAt: String(row.locked_at ?? (row as { lockedAt?: string }).lockedAt ?? new Date().toISOString()),
    reason: (row.reason as string | undefined) ?? undefined,
  };
}
