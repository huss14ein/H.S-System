export type FinancialMonthKey = { year: number; month: number }; // month: 1-12

export function clampMonthStartDay(day: unknown, fallback: number = 1): number {
  const n = Number(day);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return Math.min(31, Math.max(1, i));
}

/** Days in calendar month (month is 1–12). */
export function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Preferred fiscal “start day” capped to a real calendar day in that month
 * (e.g. 31 in February → 28 or 29).
 */
export function effectiveMonthStartDay(year: number, month1to12: number, preferredDay: number): number {
  const pref = clampMonthStartDay(preferredDay, 1);
  const dim = daysInCalendarMonth(year, month1to12);
  return Math.min(pref, dim);
}

export function effectiveMonthStartDate(year: number, month1to12: number, preferredDay: number): Date {
  const day = effectiveMonthStartDay(year, month1to12, preferredDay);
  return new Date(year, month1to12 - 1, day, 0, 0, 0, 0);
}

export function financialMonthKey(ref: Date, monthStartDay: unknown): FinancialMonthKey {
  const pref = clampMonthStartDay(monthStartDay, 1);
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const startThisCalMonth = effectiveMonthStartDate(y, m, pref);
  if (ref.getTime() >= startThisCalMonth.getTime()) {
    return { year: y, month: m };
  }
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}

export function addMonthsToKey(key: FinancialMonthKey, deltaMonths: number): FinancialMonthKey {
  const baseIndex = key.year * 12 + (key.month - 1);
  const idx = baseIndex + Math.trunc(deltaMonths);
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function financialMonthRange(ref: Date, monthStartDay: unknown): { start: Date; end: Date; key: FinancialMonthKey } {
  const pref = clampMonthStartDay(monthStartDay, 1);
  const key = financialMonthKey(ref, pref);
  const start = effectiveMonthStartDate(key.year, key.month, pref);
  const nextKey = addMonthsToKey(key, 1);
  const nextStart = effectiveMonthStartDate(nextKey.year, nextKey.month, pref);
  const end = new Date(nextStart.getTime() - 1);
  return { start, end, key };
}

export function financialMonthRangeFromKey(key: FinancialMonthKey, monthStartDay: unknown): { start: Date; end: Date } {
  const pref = clampMonthStartDay(monthStartDay, 1);
  const start = effectiveMonthStartDate(key.year, key.month, pref);
  const nextKey = addMonthsToKey(key, 1);
  const nextStart = effectiveMonthStartDate(nextKey.year, nextKey.month, pref);
  const end = new Date(nextStart.getTime() - 1);
  return { start, end };
}

