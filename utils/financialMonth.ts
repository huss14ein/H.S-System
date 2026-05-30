export type FinancialMonthKey = { year: number; month: number }; // month: 1-12

/** App default when settings have no stored month start day (salary-cycle style). */
export const DEFAULT_FINANCIAL_MONTH_START_DAY = 28;

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

/** Read `monthStartDay` from settings (DB may use snake_case). Falls back to {@link DEFAULT_FINANCIAL_MONTH_START_DAY}. */
export function resolveMonthStartDayFromData(
  data: { settings?: { monthStartDay?: number; month_start_day?: number } } | null | undefined,
): number {
  const settings = data?.settings;
  const stored = settings?.monthStartDay ?? (settings as { month_start_day?: number })?.month_start_day;
  if (stored == null) return DEFAULT_FINANCIAL_MONTH_START_DAY;
  return clampMonthStartDay(stored, DEFAULT_FINANCIAL_MONTH_START_DAY);
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

export type BudgetViewPeriod = 'Monthly' | 'Weekly' | 'Daily' | 'Yearly';

export function calendarMonthInterval(year: number, month1to12: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month1to12 - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month1to12, 0, 23, 59, 59, 999),
  };
}

/** Parse `YYYY-MM` as calendar month (matches HTML `<input type="month">`). */
export function calendarMonthRangeFromIsoKey(isoKey: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(isoKey ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return calendarMonthInterval(year, month);
}

/** Current calendar month as `YYYY-MM`. */
export function currentCalendarMonthIso(ref = new Date()): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

function dateRangesOverlap(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
}

/**
 * Whether a persisted budget row applies to the financial period selected in Budgets UI.
 * Rows may store `month` as financial index (canonical) or legacy calendar month — both are accepted.
 */
export function budgetAppliesToFinancialView(
  b: { year: number; month: number; period?: string | null },
  viewKey: FinancialMonthKey,
  monthStartDay: unknown,
  budgetView: BudgetViewPeriod,
): boolean {
  const year = Number(b.year);
  const month = Number(b.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;

  if (budgetView === 'Yearly' || b.period === 'yearly') {
    return year === viewKey.year;
  }

  if (year !== viewKey.year) return false;

  if (month === viewKey.month) return true;

  const viewRange = financialMonthRangeFromKey(viewKey, monthStartDay);
  const cal = calendarMonthInterval(year, month);
  if (dateRangesOverlap(viewRange, cal)) return true;

  const anchor = new Date(year, month - 1, 15);
  const rowFinKey = financialMonthKey(anchor, monthStartDay);
  return rowFinKey.year === viewKey.year && rowFinKey.month === viewKey.month;
}

/**
 * How well a persisted budget row matches the selected financial view (higher = preferred).
 * Used to pick one row per category when legacy calendar-index rows overlap the same window.
 */
export function budgetRowViewMatchScore(
  b: { year: number; month: number; period?: string | null },
  viewKey: FinancialMonthKey,
  monthStartDay: unknown,
): number {
  const year = Number(b.year);
  const month = Number(b.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return -1;
  if (year !== viewKey.year) return -1;

  const period = b.period ?? 'monthly';
  if (month === viewKey.month && period !== 'yearly') return 200;

  const anchor = new Date(year, month - 1, 15);
  const rowFinKey = financialMonthKey(anchor, monthStartDay);
  if (rowFinKey.year === viewKey.year && rowFinKey.month === viewKey.month) {
    return period === 'monthly' ? 100 : 90;
  }

  const viewRange = financialMonthRangeFromKey(viewKey, monthStartDay);
  const cal = calendarMonthInterval(year, month);
  if (dateRangesOverlap(viewRange, cal)) return 20;
  return -1;
}

/** One budget card per category for the active financial view (fixes duplicate Transportation/Groceries cards). */
export function dedupeBudgetRowsForFinancialView<
  T extends { category: string; year: number; month: number; period?: string | null; limit?: number },
>(
  budgets: T[],
  viewKey: FinancialMonthKey,
  monthStartDay: unknown,
  budgetView: BudgetViewPeriod,
): T[] {
  const byCategory = new Map<string, T[]>();
  for (const b of budgets) {
    if (!budgetAppliesToFinancialView(b, viewKey, monthStartDay, budgetView)) continue;
    const key = String(b.category ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = byCategory.get(key) ?? [];
    list.push(b);
    byCategory.set(key, list);
  }

  const out: T[] = [];
  for (const group of byCategory.values()) {
    let best = group[0];
    let bestScore = budgetRowViewMatchScore(best, viewKey, monthStartDay);
    for (let i = 1; i < group.length; i++) {
      const candidate = group[i];
      const score = budgetRowViewMatchScore(candidate, viewKey, monthStartDay);
      if (
        score > bestScore ||
        (score === bestScore && Number(candidate.limit) > Number(best.limit))
      ) {
        best = candidate;
        bestScore = score;
      }
    }
    if (bestScore >= 0) out.push(best);
  }
  return out;
}

