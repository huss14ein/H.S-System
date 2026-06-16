import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';

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
>;

/** Headline investments bucket — valid during fast phase (matches NW band). */
export function headlineInvestmentsBucketSar(metrics: Pick<ExtendedMetricsPickSource, 'headline'>): number {
  return Math.max(0, metrics.headline.buckets.investments);
}

/** Canonical investment total — bucket during fast phase, ROI rollup when extended. */
export function pickInvestmentsTotalSar(metrics: ExtendedMetricsPickSource, extendedReady: boolean): number {
  if (extendedReady) return metrics.investmentsTotalSar;
  return headlineInvestmentsBucketSar(metrics);
}

export function pickCommoditiesValueSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  if (!extendedReady) return null;
  return metrics.commoditiesValueSar;
}

export function pickSukukAssetsValueSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  if (!extendedReady) return null;
  return metrics.sukukAssetsValueSar;
}

export function pickPlatformsRollupSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  if (!extendedReady) return null;
  return metrics.platformsRollupSar;
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
