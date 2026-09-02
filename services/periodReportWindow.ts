import {
  addMonthsToKey,
  financialMonthColumnHeaderLabel,
  financialMonthKey,
  financialMonthKeysEndingAt,
  financialMonthRange,
  financialMonthRangeFromKey,
  type FinancialMonthKey,
} from '../utils/financialMonth';
import { priorAnalyticsSpendWindow } from './analyticsPeriodRange';

export type PeriodReportPreset =
  | 'financial_year'
  | 'calendar_year'
  | 'ytd'
  | 'last_12m'
  | 'custom';

export type PeriodReportWindowSlice = {
  start: Date;
  end: Date;
  finKeys: FinancialMonthKey[];
  periodLabel: string;
};

export type PeriodReportWindow = PeriodReportWindowSlice & {
  preset: PeriodReportPreset;
  currentFinKey: FinancialMonthKey;
  priorWindow: PeriodReportWindowSlice;
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function labelRange(finKeys: FinancialMonthKey[], msd: number): string {
  if (!finKeys.length) return '';
  const first = finKeys[0]!;
  const last = finKeys[finKeys.length - 1]!;
  const firstLabel =
    msd === 1
      ? new Date(first.year, first.month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : financialMonthColumnHeaderLabel(first.year, first.month, msd);
  const lastLabel =
    msd === 1
      ? new Date(last.year, last.month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : financialMonthColumnHeaderLabel(last.year, last.month, msd);
  return first.year === last.year && first.month === last.month ? firstLabel : `${firstLabel} – ${lastLabel}`;
}

function finKeysBetween(startKey: FinancialMonthKey, endKey: FinancialMonthKey): FinancialMonthKey[] {
  const keys: FinancialMonthKey[] = [];
  let cur = startKey;
  const endIdx = endKey.year * 12 + (endKey.month - 1);
  for (let guard = 0; guard < 240; guard++) {
    keys.push(cur);
    const idx = cur.year * 12 + (cur.month - 1);
    if (idx >= endIdx) break;
    cur = addMonthsToKey(cur, 1);
  }
  return keys;
}

function buildPriorFromFinKeys(
  finKeys: FinancialMonthKey[],
  monthStartDay: number,
): PeriodReportWindowSlice {
  const msd = Number(monthStartDay) || 1;
  const prior = priorAnalyticsSpendWindow(
    {
      start: financialMonthRangeFromKey(finKeys[0]!, msd).start,
      end: financialMonthRangeFromKey(finKeys[finKeys.length - 1]!, msd).end,
      finKeys,
      currentFinKey: finKeys[finKeys.length - 1]!,
      periodLabel: '',
      periodPreset: '12M',
    },
    msd,
  );
  return {
    start: prior.start,
    end: prior.end,
    finKeys: prior.finKeys,
    periodLabel: `Prior · ${labelRange(prior.finKeys, msd)}`,
  };
}

function sliceFromFinKeys(
  finKeys: FinancialMonthKey[],
  monthStartDay: number,
  periodLabel: string,
  endCap?: Date,
): PeriodReportWindowSlice {
  const msd = Number(monthStartDay) || 1;
  const start = financialMonthRangeFromKey(finKeys[0]!, msd).start;
  let end = financialMonthRangeFromKey(finKeys[finKeys.length - 1]!, msd).end;
  if (endCap && end.getTime() > endCap.getTime()) end = endCap;
  return { start, end, finKeys, periodLabel };
}

export type ResolvePeriodReportWindowArgs = {
  ref?: Date;
  monthStartDay: number;
  preset: PeriodReportPreset;
  /** Inclusive calendar dates for custom preset (YYYY-MM-DD or Date). */
  customStart?: string | Date;
  customEnd?: string | Date;
};

/**
 * Resolve the selected period window + equal-length prior window for the Period Financial Report.
 */
export function resolvePeriodReportWindow(args: ResolvePeriodReportWindowArgs): PeriodReportWindow {
  const msd = Number(args.monthStartDay) || 1;
  const ref = args.ref ?? new Date();
  const nowEnd = new Date(ref);
  nowEnd.setHours(23, 59, 59, 999);
  const current = financialMonthRange(ref, msd);
  const currentFinKey = current.key;

  if (args.preset === 'custom') {
    const parseStart = (raw: string | Date): Date => {
      if (typeof raw === 'string') {
        return new Date(
          Number(raw.slice(0, 4)),
          Number(raw.slice(5, 7)) - 1,
          Number(raw.slice(8, 10)),
          0,
          0,
          0,
          0,
        );
      }
      return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 0, 0, 0, 0);
    };
    const parseEnd = (raw: string | Date): Date => {
      if (typeof raw === 'string') {
        return new Date(
          Number(raw.slice(0, 4)),
          Number(raw.slice(5, 7)) - 1,
          Number(raw.slice(8, 10)),
          23,
          59,
          59,
          999,
        );
      }
      return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 23, 59, 59, 999);
    };
    let start = parseStart(args.customStart ?? ref);
    let end = parseEnd(args.customEnd ?? ref);
    if (end.getTime() < start.getTime()) {
      const s = start;
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
      end = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 59, 999);
    }
    const startKey = financialMonthKey(start, msd);
    const endKey = financialMonthKey(end, msd);
    const finKeys = finKeysBetween(startKey, endKey);
    const ms = Math.max(0, end.getTime() - start.getTime());
    const priorEnd = new Date(start.getTime() - 1);
    const priorStart = new Date(priorEnd.getTime() - ms);
    priorStart.setHours(0, 0, 0, 0);
    return {
      start,
      end,
      finKeys,
      currentFinKey,
      preset: 'custom',
      periodLabel: `Custom · ${isoDate(start)} – ${isoDate(end)}`,
      priorWindow: {
        start: priorStart,
        end: priorEnd,
        finKeys: finKeysBetween(financialMonthKey(priorStart, msd), financialMonthKey(priorEnd, msd)),
        periodLabel: `Prior · ${isoDate(priorStart)} – ${isoDate(priorEnd)}`,
      },
    };
  }

  if (args.preset === 'calendar_year') {
    const y = ref.getFullYear();
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    let end = new Date(y, 11, 31, 23, 59, 59, 999);
    if (end.getTime() > nowEnd.getTime()) end = nowEnd;
    const startKey = financialMonthKey(start, msd);
    const endKey = financialMonthKey(end, msd);
    const finKeys = finKeysBetween(startKey, endKey);
    const primary = sliceFromFinKeys(finKeys, msd, `Calendar year ${y}`, end);
    primary.start = start;
    primary.end = end;
    return {
      ...primary,
      preset: 'calendar_year',
      currentFinKey,
      priorWindow: buildPriorFromFinKeys(finKeys, msd),
    };
  }

  if (args.preset === 'financial_year') {
    const fyStartKey = { year: currentFinKey.year, month: 1 };
    const finKeys = finKeysBetween(fyStartKey, currentFinKey);
    const primary = sliceFromFinKeys(
      finKeys,
      msd,
      `Financial year ${currentFinKey.year}`,
      nowEnd,
    );
    return {
      ...primary,
      preset: 'financial_year',
      currentFinKey,
      priorWindow: buildPriorFromFinKeys(finKeys, msd),
    };
  }

  if (args.preset === 'ytd') {
    const fyStartKey = { year: currentFinKey.year, month: 1 };
    const finKeys = finKeysBetween(fyStartKey, currentFinKey);
    const primary = sliceFromFinKeys(finKeys, msd, `YTD · ${labelRange(finKeys, msd)}`, nowEnd);
    return {
      ...primary,
      preset: 'ytd',
      currentFinKey,
      priorWindow: buildPriorFromFinKeys(finKeys, msd),
    };
  }

  // last_12m
  const finKeys = financialMonthKeysEndingAt(ref, 12, msd);
  const primary = sliceFromFinKeys(finKeys, msd, `Last 12 months · ${labelRange(finKeys, msd)}`, nowEnd);
  return {
    ...primary,
    preset: 'last_12m',
    currentFinKey,
    priorWindow: buildPriorFromFinKeys(finKeys, msd),
  };
}

export function periodReportWindowMs(window: PeriodReportWindowSlice): { startMs: number; endMs: number } {
  return { startMs: window.start.getTime(), endMs: window.end.getTime() };
}
