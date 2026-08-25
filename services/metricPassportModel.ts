import type { WealthAnalyticsReportModel, WealthMetricPassportKey } from './wealthAnalyticsReportModel';
import { WEALTH_METRIC_PASSPORT_LABELS } from './wealthAnalyticsReportModel';

export type MetricPassportSection = {
  id: 'A' | 'B' | 'C';
  title: string;
  body: string;
  sparkline?: number[];
};

export type MetricPassportModel = {
  key: WealthMetricPassportKey | 'weeklyPnL' | 'portfolioPeriodPnL';
  title: string;
  valueDisplay: string;
  statusLabel: string;
  targetDisplay?: string;
  sections: MetricPassportSection[];
  generatedAtIso: string;
  sarPerUsd: number;
};

function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `SAR ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const FALLBACK_DEFINITIONS: Record<MetricPassportModel['key'], string> = {
  netWorth:
    'Headline balance sheet net worth from computePersonalHeadlineNetWorthSar — cash + investments + physical − liabilities (personal scope).',
  monthlyPnL:
    'Financial-month income minus expenses (transaction-dated FX). Cashflow P/L — not portfolio mark-to-market.',
  weeklyPnL:
    'Portfolio mark-to-market week P/L: end live value − start cost snapshot − net deposits/withdrawals. Seeded books reconstruct start cash so buys funded from broker cash are not fake gains. Ledger = realized sells, dividends, fees; market = remainder. FIFO lots when available.',
  portfolioPeriodPnL:
    'Financial-month portfolio mark-to-market P/L — same engine as Wealth Analytics and Investments platform rows (cost start + live end; seeded start-cash reconstruct).',
  investmentRoi:
    'Platform rollup + commodities + direct Sukuk vs hybrid net invested (deposits − withdrawals on funded sleeves; cost + cash floor on incomplete books — computeHeadlinePersonalInvestmentRoiDecimal).',
  emergencyFund:
    'Liquid cash (bank + idle broker cash) divided by essential monthly expenses. Target: 6 months.',
  budgetVariance:
    'Positive = under budget this financial month. Same path as Dashboard KPI row.',
};

/** In-app metric passport (text sections) — mirrors generateWealthMetricPassportHtml copy. */
export function buildMetricPassportModel(
  report: WealthAnalyticsReportModel | null | undefined,
  key: MetricPassportModel['key'],
  fallback?: { valueDisplay?: string; statusLabel?: string; sarPerUsd?: number },
): MetricPassportModel | null {
  if (!report) {
    if (!fallback?.valueDisplay) return null;
    const title =
      key in WEALTH_METRIC_PASSPORT_LABELS
        ? WEALTH_METRIC_PASSPORT_LABELS[key as WealthMetricPassportKey]
        : key === 'weeklyPnL'
          ? 'Portfolio week P/L'
          : key === 'portfolioPeriodPnL'
            ? 'Portfolio period P/L'
            : key;
    const def = FALLBACK_DEFINITIONS[key] ?? 'Derived from your Finova data. Educational context only.';
    return {
      key,
      title,
      valueDisplay: fallback.valueDisplay,
      statusLabel: fallback.statusLabel ?? '',
      sections: [
        { id: 'A', title: 'Current reading', body: `Displayed value: ${fallback.valueDisplay}` },
        { id: 'B', title: 'Trend', body: 'Open Wealth Analytics for sparkline history when extended metrics are ready.' },
        { id: 'C', title: 'Definition & reconciliation', body: def },
      ],
      generatedAtIso: new Date().toISOString(),
      sarPerUsd: fallback.sarPerUsd ?? 3.75,
    };
  }

  const kpi = report.executiveKpis.find((k) => k.key === key);
  const title =
    key === 'weeklyPnL'
      ? 'Portfolio week P/L'
      : key === 'portfolioPeriodPnL'
        ? 'Portfolio period P/L'
        : WEALTH_METRIC_PASSPORT_LABELS[key as WealthMetricPassportKey];

  let sectionC = '';
  if (key === 'netWorth') {
    sectionC = `Headline balance sheet net worth from computePersonalHeadlineNetWorthSar. Investments total ${money(report.investmentsTotalSar)}. Liquid cash ${money(report.liquidCashSar)}.`;
  } else if (key === 'monthlyPnL') {
    sectionC =
      'Financial-month income minus expenses (transaction-dated FX). This is cashflow P/L — not portfolio mark-to-market.';
  } else if (key === 'weeklyPnL' || key === 'portfolioPeriodPnL') {
    sectionC = `Portfolio week P/L ${money(report.weeklyPnLTotalSar)}; financial-month portfolio P/L ${money(report.monthlyPnLTotalSar)}. Mark-to-market from period start: ledger (realized sells, dividends, fees) + market estimate (price change). Realized leg uses FIFO lots when available; otherwise weighted average.`;
  } else if (key === 'investmentRoi') {
    sectionC = `Present value ${money(report.investmentsTotalSar)}. Net invested after withdrawals ${money(report.investmentNetInvestedSar)}. Growth ${money(report.investmentGrowthSar)}${report.investmentPrincipalFullyRecovered ? ' (principal recovered — leftover value is profit)' : ''}. Same path as Investments: computeHeadlinePersonalInvestmentRoiDecimal.`;
  } else if (key === 'budgetVariance') {
    sectionC = 'Positive = under budget this financial month. Same path as Dashboard KPI row.';
  } else {
    sectionC = `Target ${report.executiveKpis.find((k) => k.key === 'emergencyFund')?.targetDisplay ?? '6 mo'}. Liquid cash ${money(report.liquidCashSar)}.`;
  }

  const pnlSeries =
    key === 'monthlyPnL'
      ? report.monthlyPnLCumulative
      : key === 'weeklyPnL' || key === 'portfolioPeriodPnL'
        ? report.weeklyPnLCumulative
        : kpi?.sparkline ?? [];

  return {
    key,
    title,
    valueDisplay: kpi?.valueDisplay ?? fallback?.valueDisplay ?? '—',
    statusLabel: kpi?.statusLabel ?? fallback?.statusLabel ?? '',
    targetDisplay: kpi?.targetDisplay,
    sections: [
      {
        id: 'A',
        title: 'Current reading',
        body: kpi?.targetDisplay ? `Target ${kpi.targetDisplay}` : 'No target set',
      },
      {
        id: 'B',
        title: 'Trend',
        body: pnlSeries.length >= 2 ? `${pnlSeries.length} points in series` : 'Insufficient history for trend.',
        sparkline: pnlSeries.length >= 2 ? pnlSeries : undefined,
      },
      { id: 'C', title: 'Definition & reconciliation', body: sectionC },
    ],
    generatedAtIso: report.generatedAtIso,
    sarPerUsd: report.sarPerUsd,
  };
}
