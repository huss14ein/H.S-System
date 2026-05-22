export type FinancialMonthKey = { year: number; month: number }; // month: 1-12

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse `YYYY-MM-DD` (or ISO datetime prefix) as local calendar midnight — not UTC. */
export function parseCalendarDateLocal(input: string | Date): Date {
  if (input instanceof Date) return input;
  const s = String(input ?? '').trim();
  const m = s.match(ISO_DATE_PREFIX);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return new Date(y, mo - 1, d, 0, 0, 0, 0);
    }
  }
  return new Date(s);
}

/** Local calendar-day start (ms) for range compares — avoids `new Date("YYYY-MM-DD")` UTC shift. */
export function calendarDayStartMs(input: string | Date): number {
  const d = parseCalendarDateLocal(input);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

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

/** Read `monthStartDay` from settings (DB may use snake_case). */
export function resolveMonthStartDayFromData(
  data: { settings?: { monthStartDay?: number; month_start_day?: number } } | null | undefined,
): number {
  const raw = Number(data?.settings?.monthStartDay ?? (data?.settings as { month_start_day?: number })?.month_start_day ?? 1);
  return clampMonthStartDay(raw, 1);
}

/** Plan / annual grid column index (0–11) for a transaction date within `planYear`. */
export function financialMonthColumnIndexForDate(
  txDate: Date | string,
  planYear: number,
  monthStartDay: unknown,
): number | null {
  const d = typeof txDate === 'string' ? new Date(txDate) : txDate;
  if (Number.isNaN(d.getTime())) return null;
  const key = financialMonthKey(d, monthStartDay);
  if (key.year !== planYear) return null;
  return key.month - 1;
}

/** Last plan column index (0–11) to include in YTD for `planYear` as of `ref`. */
export function currentFinancialMonthColumnEndIndex(
  planYear: number,
  ref: Date,
  monthStartDay: unknown,
): number {
  const key = financialMonthKey(ref, monthStartDay);
  if (key.year < planYear) return -1;
  if (key.year > planYear) return 11;
  return key.month - 1;
}

export function transactionDateInFinancialPlanYear(
  txDate: Date | string,
  planYear: number,
  monthStartDay: unknown,
): boolean {
  return financialMonthColumnIndexForDate(txDate, planYear, monthStartDay) != null;
}

export function financialMonthLabel(key: FinancialMonthKey, monthStartDay: unknown): string {
  const { start, end } = financialMonthRangeFromKey(key, monthStartDay);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

const CALENDAR_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact header for plan grid / charts (calendar short name when day 1, else start–end range). */
export function financialMonthColumnHeaderLabel(
  planYear: number,
  month1to12: number,
  monthStartDay: unknown,
): string {
  if (clampMonthStartDay(monthStartDay, 1) === 1) {
    return CALENDAR_MONTH_SHORT[month1to12 - 1] ?? `M${month1to12}`;
  }
  const { start, end } = financialMonthRangeFromKey({ year: planYear, month: month1to12 }, monthStartDay);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)}–${fmt(end)}`;
}

/** Twelve column labels for a plan year grid. */
export function financialMonthColumnHeadersForPlanYear(planYear: number, monthStartDay: unknown): string[] {
  return Array.from({ length: 12 }, (_, i) => financialMonthColumnHeaderLabel(planYear, i + 1, monthStartDay));
}

export function financialMonthIsoKey(key: FinancialMonthKey): string {
  return `${key.year}-${String(key.month).padStart(2, '0')}`;
}

/** Last `count` financial months ending at `ref`, oldest → newest (for trend charts). */
export function financialMonthKeysEndingAt(
  ref: Date,
  count: number,
  monthStartDay: unknown,
): FinancialMonthKey[] {
  const pref = clampMonthStartDay(monthStartDay, 1);
  let key = financialMonthKey(ref, pref);
  const keys: FinancialMonthKey[] = [];
  for (let i = 0; i < count; i++) {
    keys.unshift(key);
    key = addMonthsToKey(key, -1);
  }
  return keys;
}

export function transactionInFinancialMonth(
  txDate: Date | string,
  finKey: FinancialMonthKey,
  monthStartDay: unknown,
): boolean {
  const col = financialMonthColumnIndexForDate(txDate, finKey.year, monthStartDay);
  return col === finKey.month - 1;
}

export function dateInRange(txDate: Date | string, start: Date, end: Date): boolean {
  const txMs = calendarDayStartMs(txDate);
  if (Number.isNaN(txMs)) return false;
  const startMs = calendarDayStartMs(start);
  const endMs = calendarDayStartMs(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return txMs >= startMs && txMs <= endMs;
}

/** Start of the financial month `monthsBack` periods before the month containing `ref` (inclusive window). */
export function financialMonthLookbackStart(ref: Date, monthsBack: number, monthStartDay: unknown): Date {
  const pref = clampMonthStartDay(monthStartDay, 1);
  const current = financialMonthKey(ref, pref);
  const startKey = addMonthsToKey(current, -(Math.max(1, monthsBack) - 1));
  return financialMonthRangeFromKey(startKey, pref).start;
}

/** Parse `YYYY-MM` financial month key → range (invalid → current financial month). */
export function financialMonthRangeFromIsoKey(
  isoKey: string,
  monthStartDay: unknown,
  ref = new Date(),
): { start: Date; end: Date; key: FinancialMonthKey } {
  const m = /^(\d{4})-(\d{2})$/.exec(isoKey.trim());
  if (!m) return financialMonthRange(ref, monthStartDay);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return financialMonthRange(ref, monthStartDay);
  }
  const key = { year, month };
  const { start, end } = financialMonthRangeFromKey(key, monthStartDay);
  return { start, end, key };
}

/** Current financial month as `YYYY-MM` (fiscal key, not calendar month). */
export function currentFinancialMonthIso(ref: Date, monthStartDay: unknown): string {
  return financialMonthIsoKey(financialMonthKey(ref, monthStartDay));
}

