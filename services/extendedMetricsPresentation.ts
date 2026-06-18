import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';
import type { HeadlinePersonalInvestmentRoi } from './investmentKpiCore';

export type ExtendedMetricsPickSource = Pick<
  UseCanonicalFinancialMetricsResult,
  | 'investmentsTotalSar'
  | 'commoditiesValueSar'
  | 'sukukAssetsValueSar'
  | 'platformsRollupSar'
  | 'investableCashTotalSar'
  | 'investmentExposure'
  | 'wealthSummary'
  | 'headline'
  | 'kpiSnapshot'
>;

/** Headline investments bucket — valid during fast phase (matches NW band). */
export function headlineInvestmentsBucketSar(metrics: Pick<ExtendedMetricsPickSource, 'headline'>): number {
  return Math.max(0, metrics.headline.buckets.investments);
}

/** Minimal fields for headline exposure pickers (dashboard + investments surfaces). */
export type HeadlineExposurePickSource = Pick<ExtendedMetricsPickSource, 'headline' | 'kpiSnapshot'> & {
  investmentExposure?: ExtendedMetricsPickSource['investmentExposure'];
};

/** Total investment exposure (SAR) — matches Investments hub Total Value card. */
export function pickHeadlineInvestmentsExposureSar(metrics: HeadlineExposurePickSource): number {
  return pickHeadlineInvestmentExposure(metrics)?.totalExposureSar ?? headlineInvestmentsBucketSar(metrics);
}

/** Live headline ROI rollup — available in fast tier via kpiSnapshot. */
export function pickHeadlineInvestmentExposure(
  metrics: HeadlineExposurePickSource,
): HeadlinePersonalInvestmentRoi | null {
  return metrics.investmentExposure ?? metrics.kpiSnapshot?.headlineInvestmentExposure ?? null;
}

/** True when net gain/loss, ROI, and daily P/L can render without waiting for phase-2 async. */
export function hasHeadlineInvestmentKpis(metrics: ExtendedMetricsPickSource): boolean {
  return pickHeadlineInvestmentExposure(metrics) != null;
}

/** Canonical investment total — exposure rollup when available, else bucket during fast phase. */
export function pickInvestmentsTotalSar(metrics: ExtendedMetricsPickSource, extendedReady: boolean): number {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure) return exposure.totalExposureSar;
  if (extendedReady) return metrics.investmentsTotalSar;
  return headlineInvestmentsBucketSar(metrics);
}

export function pickCommoditiesValueSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure) return exposure.commoditiesValueSar;
  if (!extendedReady) return null;
  return metrics.commoditiesValueSar;
}

export function pickSukukAssetsValueSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure) return exposure.sukukAssetsValueSar;
  if (!extendedReady) return null;
  return metrics.sukukAssetsValueSar;
}

export function pickPlatformsRollupSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure) return exposure.platformsRollupSar;
  if (!extendedReady) return null;
  return metrics.platformsRollupSar;
}

/** Investments hub headline KPI row — one object for all four cards (same path as System Health reconciliation). */
export type InvestmentsHeadlineKpiRow = {
  totalValue: number;
  totalGainLoss: number;
  roi: number;
  totalDailyPnL: number;
  trendPercentage: number;
  platformsRollupSAR: number;
  commoditiesValueSAR: number;
  sukukAssetsValueSAR: number;
};

export function buildInvestmentsHeadlineKpiRow(
  metrics: ExtendedMetricsPickSource,
): InvestmentsHeadlineKpiRow | null {
  const h = pickHeadlineInvestmentExposure(metrics);
  if (!h) return null;
  const totalValue = h.totalExposureSar;
  const totalGainLoss = h.totalGainLossSar;
  const roi = Number.isFinite(h.roi) ? h.roi * 100 : 0;
  const totalDailyPnL = h.platformsDailyPnLSar + h.commoditiesDailyPnLSar;
  const previousTotalValue = totalValue - totalDailyPnL;
  const trendPercentage = previousTotalValue > 0 ? (totalDailyPnL / previousTotalValue) * 100 : 0;
  return {
    totalValue,
    totalGainLoss,
    roi,
    totalDailyPnL,
    trendPercentage,
    platformsRollupSAR: h.platformsRollupSar,
    commoditiesValueSAR: h.commoditiesValueSar,
    sukukAssetsValueSAR: h.sukukAssetsValueSar,
  };
}

export function pickDashboardRoiDecimal(metrics: HeadlineExposurePickSource): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure && Number.isFinite(exposure.roi)) return exposure.roi;
  const snap = metrics.kpiSnapshot?.roi;
  return snap != null && Number.isFinite(snap) ? snap : null;
}

/** True when gain/loss, ROI, and daily P/L are internally consistent (same rollup object). */
export function headlineKpiMathIsConsistent(h: HeadlinePersonalInvestmentRoi): boolean {
  if (!(h.netCapitalSar > 0)) return h.totalGainLossSar === 0 && h.roi === 0;
  const impliedRoi = h.totalGainLossSar / h.netCapitalSar;
  return Math.abs(impliedRoi - h.roi) < 0.0001;
}

export function pickInvestableCashTotalSar(metrics: ExtendedMetricsPickSource): number {
  return metrics.investableCashTotalSar;
}

export function pickWealthSummary(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): UseCanonicalFinancialMetricsResult['wealthSummary'] {
  if (!extendedReady) return null;
  return metrics.wealthSummary;
}
