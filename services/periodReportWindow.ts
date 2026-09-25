/**
 * Period windows for the Period Financial Report: FY / CY / YTD / 12M / custom + prior twin.
 */
import {
  addMonthsToKey,
  financialMonthKeysEndingAt,
  financialMonthRange,
  financialMonthRangeFromKey,
  type FinancialMonthKey,
} from '../utils/financialMonth';

export type PeriodReportPreset = 'FY' | 'CY' | 'YTD' | '12M' | 'custom';

export type PeriodReportWindow = {
  preset: PeriodReportPreset;
  label: string;
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  /** Financial-month keys covered (empty for pure calendar custom when msd unused). */
  finKeys: FinancialMonthKey[];
  monthStartDay: number;
};

export type PeriodReportTwinWindows = {
  current: PeriodReportWindow;
  /** Equal-length window immediately before `current`. */
  prior: PeriodReportWindow;
};

function toIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatRangeLabel(start: Date, end: Date, preset: PeriodReportPreset): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const a = start.toLocaleDateString('en-US', opts);
  const b = end.toLocaleDateString('en-US', opts);
  return `${preset} · ${a} – ${b}`;
}

function windowFromRange(
  preset: PeriodReportPreset,
  start: Date,
  end: Date,
  finKeys: FinancialMonthKey[],
  monthStartDay: number,
): PeriodReportWindow {
  const s = startOfLocalDay(start);
  const e = endOfLocalDay(end);
  return {
    preset,
    label: formatRangeLabel(s, e, preset),
    start: s,
    end: e,
    startIso: toIsoDay(s),
    endIso: toIsoDay(e),
    finKeys,
    monthStartDay,
  };
}

/**
 * Resolve a report window.
 * - FY: financial-year start (month column 1 of current FY) through today
 * - CY: calendar Jan 1 through today
 * - YTD: same as FY when monthStartDay ≠ 1; calendar YTD when msd === 1
 * - 12M: last 12 financial months through current FM end (clamped to today)
 * - custom: inclusive [customStart, customEnd] (ISO yyyy-mm-dd)
 */
export function resolvePeriodReportWindow(args: {
  preset: PeriodReportPreset;
  monthStartDay: number;
  now?: Date;
  customStartIso?: string;
  customEndIso?: string;
}): PeriodReportWindow {
  const now = args.now ?? new Date();
  const msd = Number(args.monthStartDay) || 1;
  const today = startOfLocalDay(now);
  const currentFm = financialMonthRange(now, msd);

  if (args.preset === 'custom') {
    const startRaw = String(args.customStartIso || '').slice(0, 10);
    const endRaw = String(args.customEndIso || '').slice(0, 10);
    const start = startRaw ? startOfLocalDay(new Date(`${startRaw}T12:00:00`)) : today;
    const end = endRaw ? endOfLocalDay(new Date(`${endRaw}T12:00:00`)) : endOfLocalDay(today);
    const orderedStart = start.getTime() <= end.getTime() ? start : startOfLocalDay(end);
    const orderedEnd = start.getTime() <= end.getTime() ? end : endOfLocalDay(start);
    return windowFromRange('custom', orderedStart, orderedEnd, [], msd);
  }

  if (args.preset === 'CY') {
    const start = new Date(today.getFullYear(), 0, 1);
    return windowFromRange('CY', start, today, [], msd);
  }

  if (args.preset === '12M') {
    const finKeys = financialMonthKeysEndingAt(now, 12, msd);
    const start = financialMonthRangeFromKey(finKeys[0]!, msd).start;
    const end = today.getTime() < currentFm.end.getTime() ? today : currentFm.end;
    return windowFromRange('12M', start, end, finKeys, msd);
  }

  // FY and YTD: financial year from column 1 of current FY through today
  // When msd===1, YTD aligns with calendar YTD months; still use FM keys for budget columns.
  if (args.preset === 'YTD' && msd === 1) {
    const start = new Date(today.getFullYear(), 0, 1);
    const finKeys: FinancialMonthKey[] = Array.from({ length: currentFm.key.month }, (_, i) => ({
      year: currentFm.key.year,
      month: i + 1,
    }));
    return windowFromRange('YTD', start, today, finKeys, msd);
  }

  const finKeys: FinancialMonthKey[] = Array.from({ length: currentFm.key.month }, (_, i) => ({
    year: currentFm.key.year,
    month: i + 1,
  }));
  const start = financialMonthRangeFromKey(finKeys[0]!, msd).start;
  return windowFromRange(args.preset === 'YTD' ? 'YTD' : 'FY', start, today, finKeys, msd);
}

/** Prior twin: same duration immediately before current.start. */
export function resolvePeriodReportPriorTwin(current: PeriodReportWindow): PeriodReportWindow {
  const durationMs = Math.max(0, current.end.getTime() - current.start.getTime());
  const priorEnd = new Date(current.start.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - durationMs);
  const finKeys =
    current.finKeys.length > 0
      ? (() => {
          const anchorKey = addMonthsToKey(current.finKeys[0]!, -1);
          return financialMonthKeysEndingAt(
            financialMonthRangeFromKey(anchorKey, current.monthStartDay).end,
            current.finKeys.length,
            current.monthStartDay,
          );
        })()
      : [];
  return windowFromRange(
    current.preset,
    priorStart,
    priorEnd,
    finKeys,
    current.monthStartDay,
  );
}

export function resolvePeriodReportTwinWindows(args: {
  preset: PeriodReportPreset;
  monthStartDay: number;
  now?: Date;
  customStartIso?: string;
  customEndIso?: string;
}): PeriodReportTwinWindows {
  const current = resolvePeriodReportWindow(args);
  return { current, prior: resolvePeriodReportPriorTwin(current) };
}

export function validateCustomPeriodRange(
  startIso: string,
  endIso: string,
): { ok: true } | { ok: false; message: string } {
  const s = String(startIso || '').trim();
  const e = String(endIso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return { ok: false, message: 'Enter valid start and end dates (YYYY-MM-DD).' };
  }
  if (s > e) {
    return { ok: false, message: 'Start date must be on or before end date.' };
  }
  const span = (new Date(`${e}T12:00:00`).getTime() - new Date(`${s}T12:00:00`).getTime()) / 86400000;
  if (span > 366 * 5) {
    return { ok: false, message: 'Custom range cannot exceed 5 years.' };
  }
  return { ok: true };
}
