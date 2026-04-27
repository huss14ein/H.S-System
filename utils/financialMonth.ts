export type FinancialMonthKey = { year: number; month: number }; // month: 1-12

export function clampMonthStartDay(day: unknown, fallback: number = 1): number {
  const n = Number(day);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return Math.min(28, Math.max(1, i));
}

export function financialMonthKey(ref: Date, monthStartDay: unknown): FinancialMonthKey {
  const startDay = clampMonthStartDay(monthStartDay, 1);
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  if (ref.getDate() >= startDay) return { year: y, month: m };
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
  const startDay = clampMonthStartDay(monthStartDay, 1);
  const key = financialMonthKey(ref, startDay);
  const start = new Date(key.year, key.month - 1, startDay, 0, 0, 0, 0);
  const nextKey = addMonthsToKey(key, 1);
  const nextStart = new Date(nextKey.year, nextKey.month - 1, startDay, 0, 0, 0, 0);
  const end = new Date(nextStart.getTime() - 1);
  return { start, end, key };
}

export function financialMonthRangeFromKey(key: FinancialMonthKey, monthStartDay: unknown): { start: Date; end: Date } {
  const startDay = clampMonthStartDay(monthStartDay, 1);
  const start = new Date(key.year, key.month - 1, startDay, 0, 0, 0, 0);
  const nextKey = addMonthsToKey(key, 1);
  const nextStart = new Date(nextKey.year, nextKey.month - 1, startDay, 0, 0, 0, 0);
  const end = new Date(nextStart.getTime() - 1);
  return { start, end };
}

