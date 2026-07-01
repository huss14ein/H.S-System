import {
  calendarDayStartMs,
  financialMonthColumnHeaderLabel,
  financialMonthRangeFromKey,
  resolveMonthStartDayFromData,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import type { FinancialData } from '../types';

/** Label for a financial month key (`YYYY-MM` = fiscal index, not calendar month when day > 1). */
export function financialMonthKeyLabel(
  isoKey: string,
  monthStartDay: unknown,
  lang: 'en' | 'ar' = 'en',
): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoKey.trim());
  if (!m) return isoKey;
  const key: FinancialMonthKey = { year: Number(m[1]), month: Number(m[2]) };
  const pref = Number(monthStartDay) || 1;
  if (pref === 1) {
    const d = new Date(key.year, key.month - 1, 1);
    return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', year: '2-digit' });
  }
  return financialMonthColumnHeaderLabel(key.year, key.month, pref);
}

/** Whether a financial month bucket overlaps a calendar date filter from the cockpit toolbar. */
export function financialMonthKeyOverlapsIsoRange(
  isoKey: string,
  monthStartDay: unknown,
  startIso?: string,
  endIso?: string,
): boolean {
  if (!startIso && !endIso) return true;
  const m = /^(\d{4})-(\d{2})$/.exec(isoKey.trim());
  if (!m) return true;
  const key: FinancialMonthKey = { year: Number(m[1]), month: Number(m[2]) };
  const { start, end } = financialMonthRangeFromKey(key, monthStartDay);
  const finStart = calendarDayStartMs(start);
  const finEnd = calendarDayStartMs(end);
  const filterStart = startIso ? calendarDayStartMs(startIso) : Number.NEGATIVE_INFINITY;
  const filterEnd = endIso ? calendarDayStartMs(endIso) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(finStart) || !Number.isFinite(finEnd)) return true;
  return finStart <= filterEnd && finEnd >= filterStart;
}

export function resolveCockpitMonthStartDay(data: FinancialData | null | undefined): number {
  return resolveMonthStartDayFromData(data);
}
