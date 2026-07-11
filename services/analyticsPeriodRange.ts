import {
  addMonthsToKey,
  financialMonthColumnHeaderLabel,
  financialMonthKeysEndingAt,
  financialMonthRange,
  financialMonthRangeFromKey,
  type FinancialMonthKey,
} from '../utils/financialMonth';

export type AnalyticsPeriodPreset = 'MTD' | '3M' | '6M' | '12M' | 'YTD';

export type AnalyticsSpendWindow = {
  start: Date;
  end: Date;
  finKeys: FinancialMonthKey[];
  currentFinKey: FinancialMonthKey;
  periodLabel: string;
  periodPreset: AnalyticsPeriodPreset;
};

export function resolveAnalyticsSpendWindow(
  ref: Date,
  monthStartDay: number,
  preset: AnalyticsPeriodPreset = 'MTD',
): AnalyticsSpendWindow {
  const msd = Number(monthStartDay) || 1;
  const current = financialMonthRange(ref, msd);
  const currentFinKey = current.key;

  if (preset === 'MTD') {
    const periodLabel =
      msd === 1
        ? new Date(currentFinKey.year, currentFinKey.month - 1, 1).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          })
        : financialMonthColumnHeaderLabel(currentFinKey.year, currentFinKey.month, msd);
    return {
      start: current.start,
      end: current.end,
      finKeys: [currentFinKey],
      currentFinKey,
      periodLabel,
      periodPreset: preset,
    };
  }

  const finKeys: FinancialMonthKey[] =
    preset === 'YTD'
      ? Array.from({ length: currentFinKey.month }, (_, i) => ({
          year: currentFinKey.year,
          month: i + 1,
        }))
      : financialMonthKeysEndingAt(
          ref,
          preset === '3M' ? 3 : preset === '6M' ? 6 : 12,
          msd,
        );

  const start = financialMonthRangeFromKey(finKeys[0]!, msd).start;
  const end = current.end;
  const firstLabel =
    msd === 1
      ? new Date(finKeys[0]!.year, finKeys[0]!.month - 1, 1).toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        })
      : financialMonthColumnHeaderLabel(finKeys[0]!.year, finKeys[0]!.month, msd);
  const lastLabel =
    msd === 1
      ? new Date(currentFinKey.year, currentFinKey.month - 1, 1).toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        })
      : financialMonthColumnHeaderLabel(currentFinKey.year, currentFinKey.month, msd);

  return {
    start,
    end,
    finKeys,
    currentFinKey,
    periodLabel: `${preset} · ${firstLabel} – ${lastLabel}`,
    periodPreset: preset,
  };
}

/** Prior window of equal length immediately before `window`. */
export function priorAnalyticsSpendWindow(
  window: AnalyticsSpendWindow,
  monthStartDay: number,
): { start: Date; end: Date; finKeys: FinancialMonthKey[] } {
  const msd = Number(monthStartDay) || 1;
  const count = window.finKeys.length;
  const anchorKey = addMonthsToKey(window.finKeys[0]!, -1);
  const priorKeys = financialMonthKeysEndingAt(
    financialMonthRangeFromKey(anchorKey, msd).end,
    count,
    msd,
  );
  return {
    start: financialMonthRangeFromKey(priorKeys[0]!, msd).start,
    end: financialMonthRangeFromKey(priorKeys[priorKeys.length - 1]!, msd).end,
    finKeys: priorKeys,
  };
}
