import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';

const KEY = 'finova_sar_per_usd_by_day_v1';
const SNAPSHOT_KEY = 'finova_nw_snapshots_v1';

let fxMapMemoryCache: Record<string, number> | null = null;
/** Skip re-running the dense forward-fill when spot/today/horizon unchanged this session. */
let lastHydrateFingerprint = '';

/** Test helper — reset in-memory FX map cache. */
export function clearFxMapMemoryCacheForTests(): void {
  fxMapMemoryCache = null;
  lastHydrateFingerprint = '';
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function loadSarPerUsdByDay(): Record<string, number> {
  if (fxMapMemoryCache) return fxMapMemoryCache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      fxMapMemoryCache = {};
      return fxMapMemoryCache;
    }
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== 'object' || !p || Array.isArray(p)) {
      fxMapMemoryCache = {};
      return fxMapMemoryCache;
    }
    fxMapMemoryCache = p as Record<string, number>;
    return fxMapMemoryCache;
  } catch {
    fxMapMemoryCache = {};
    return fxMapMemoryCache;
  }
}

function saveMap(m: Record<string, number>): void {
  fxMapMemoryCache = m;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* quota / private mode */
  }
}

/** Persist SAR per 1 USD for a calendar day (yyyy-mm-dd). */
export function recordSarPerUsdForCalendarDay(day: string, rate: number): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  if (!Number.isFinite(rate) || rate <= 0) return;
  const m = loadSarPerUsdByDay();
  m[day] = rate;
  saveMap(m);
}

function readNetWorthSnapshotsForFxSeed(): Array<{ at: string; sarPerUsd?: number }> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Spot / current resolution: always `resolveSarPerUsd(data, uiExchangeRate)`.
 * Historical days: stored map, then forward-fill from last known ≤ day, else spot.
 * Pass `fxMap` when looping many transactions in one KPI compute to avoid re-parsing localStorage.
 */
export function getSarPerUsdForCalendarDay(
  day: string,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
  fxMap?: Record<string, number>,
): number {
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const map = fxMap ?? loadSarPerUsdByDay();
  const direct = map[day];
  if (direct != null && Number.isFinite(direct) && direct > 0) return direct;

  const keys = Object.keys(map).filter((k) => k.length === 10 && k <= day).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const v = map[keys[i]!]!;
    if (Number.isFinite(v) && v > 0) return v;
  }
  const after = Object.keys(map).filter((k) => k.length === 10 && k >= day).sort()[0];
  if (after != null) {
    const v = map[after];
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return spot;
}

/**
 * Ensures we have a dense SAR/USD point for every calendar day in [today - horizonDays, today],
 * using: current spot for today, snapshot-embedded rates when present, forward-fill for gaps.
 * Call after data load and whenever spot FX meaningfully changes (e.g. Dashboard mount).
 */
export function hydrateSarPerUsdDailySeries(
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
  options?: { horizonDays?: number; earliestCalendarDay?: string },
): void {
  const spot = resolveSarPerUsd(data, uiExchangeRate);
  const horizon = Math.min(4000, Math.max(30, options?.horizonDays ?? 400));
  const today = isoDate(new Date());
  const earliest = options?.earliestCalendarDay ?? '';
  const fingerprint = `${today}:${spot.toFixed(6)}:${horizon}:${earliest}`;
  const existing = loadSarPerUsdByDay();
  if (fingerprint === lastHydrateFingerprint && Object.keys(existing).length >= Math.min(horizon, 60)) {
    return;
  }

  const map = { ...existing };
  let dirty = map[today] !== spot;
  map[today] = spot;

  for (const s of readNetWorthSnapshotsForFxSeed()) {
    const day = typeof s.at === 'string' ? s.at.slice(0, 10) : '';
    const r = s.sarPerUsd;
    if (day.length === 10 && typeof r === 'number' && Number.isFinite(r) && r > 0 && map[day] !== r) {
      map[day] = r;
      dirty = true;
    }
  }

  const end = new Date(`${today}T12:00:00`);
  let start = new Date(end);
  start.setDate(start.getDate() - horizon);
  if (earliest && /^\d{4}-\d{2}-\d{2}$/.test(earliest)) {
    const e = new Date(`${earliest}T12:00:00`);
    if (e < start) start = e;
  }

  let carry = spot;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDate(d);
    const v = map[key];
    if (v != null && Number.isFinite(v) && v > 0) {
      carry = v;
    } else if (map[key] !== carry) {
      map[key] = carry;
      dirty = true;
    }
  }

  if (dirty) {
    saveMap(map);
  } else {
    fxMapMemoryCache = map;
  }
  lastHydrateFingerprint = fingerprint;
}

/** KPI path — returns cached map; hydrates only when the session fingerprint is stale. */
export function fxMapForKpiCompute(
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): Record<string, number> {
  hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  return loadSarPerUsdByDay();
}

/** One row per calendar day from startDay to endDay inclusive (after hydration). */
export function listDenseSarPerUsdSeries(
  startDay: string,
  endDay: string,
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): { date: string; sarPerUsd: number }[] {
  if (startDay > endDay) return [];
  const spanDays =
    Math.ceil((new Date(`${endDay}T12:00:00`).getTime() - new Date(`${startDay}T12:00:00`).getTime()) / 86400000) + 1;
  hydrateSarPerUsdDailySeries(data, uiExchangeRate, {
    horizonDays: Math.max(400, spanDays + 5),
    earliestCalendarDay: startDay,
  });
  const out: { date: string; sarPerUsd: number }[] = [];
  const start = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${endDay}T12:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDate(d);
    out.push({
      date: key,
      sarPerUsd: getSarPerUsdForCalendarDay(key, data, uiExchangeRate),
    });
  }
  return out;
}

/** Latest spot from resolver (same as KPI “today”). */
export function getSpotSarPerUsd(data: FinancialData | null | undefined, uiExchangeRate: number): number {
  return resolveSarPerUsd(data, uiExchangeRate);
}

export function countRecordedFxDays(): number {
  return Object.keys(loadSarPerUsdByDay()).length;
}
