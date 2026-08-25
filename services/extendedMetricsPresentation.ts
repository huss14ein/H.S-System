import type { UseCanonicalFinancialMetricsResult } from '../hooks/canonicalFinancialMetricsBundle';
import type { HeadlinePersonalInvestmentRoi } from './investmentKpiCore';
import {
  formatInvestmentAgeLabel,
  HEADLINE_NEAR_ZERO_NET_INVESTED_SAR,
  safeCapitalDepositYmd,
} from './investmentKpiCore';
import { describeInvestmentNetInvested } from './investmentCapitalResolve';

export type ExtendedMetricsPickSource = Pick<
  UseCanonicalFinancialMetricsResult,
  | 'investmentsTotalSar'
  | 'commoditiesValueSar'
  | 'sukukPositionsValueSar'
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

/** Total investment exposure (SAR) — matches Investments hub Present value card. */
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

export function pickSukukPositionsValueSar(
  metrics: ExtendedMetricsPickSource,
  extendedReady: boolean,
): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure) return exposure.sukukPositionsValueSar;
  if (!extendedReady) return null;
  return metrics.sukukPositionsValueSar;
}

/** @deprecated Use pickSukukPositionsValueSar */
export const pickSukukAssetsValueSar = pickSukukPositionsValueSar;

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
  sukukPositionsValueSAR: number;
  /** Deposits − withdrawals (+ commodity/Sukuk cost) used as ROI denominator. */
  netInvestedSar: number;
  depositsRecordedSar: number;
  totalWithdrawnSar: number;
  capitalSource: HeadlinePersonalInvestmentRoi['capitalSource'];
  principalFullyRecovered: boolean;
  firstCapitalDepositYmd: string | null;
  investmentAgeDays: number | null;
  investmentAgeLabel: string | null;
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
  const investmentAgeDays = h.investmentAgeDays ?? null;
  return {
    totalValue,
    totalGainLoss,
    roi,
    totalDailyPnL,
    trendPercentage,
    platformsRollupSAR: h.platformsRollupSar,
    commoditiesValueSAR: h.commoditiesValueSar,
    sukukPositionsValueSAR: h.sukukPositionsValueSar,
    netInvestedSar: h.netCapitalSar,
    depositsRecordedSar: h.depositsRecordedSar,
    totalWithdrawnSar: h.totalWithdrawnSar,
    capitalSource: h.capitalSource,
    principalFullyRecovered: h.principalFullyRecovered,
    firstCapitalDepositYmd: safeCapitalDepositYmd(h.firstCapitalDepositYmd),
    investmentAgeDays,
    investmentAgeLabel: formatInvestmentAgeLabel(investmentAgeDays),
  };
}

export function pickDashboardRoiDecimal(metrics: HeadlineExposurePickSource): number | null {
  const exposure = pickHeadlineInvestmentExposure(metrics);
  if (exposure && Number.isFinite(exposure.roi)) return exposure.roi;
  const snap = metrics.kpiSnapshot?.roi;
  return snap != null && Number.isFinite(snap) ? snap : null;
}

export type HeadlineInvestmentGrowthPresentation = {
  valueDisplay: string;
  roiPct: number;
  presentValueSar: number;
  netInvestedSar: number;
  growthSar: number;
  depositsRecordedSar: number;
  totalWithdrawnSar: number;
  principalFullyRecovered: boolean;
  isGrowing: boolean;
  statusLabel: string;
  investmentAgeLabel: string | null;
  firstCapitalDepositYmd: string | null;
  definition: string;
};

/** Single display object for Dashboard, Analytics, Analysis, passport, AI, and exports. */
export function presentHeadlineInvestmentGrowth(
  h: HeadlinePersonalInvestmentRoi | null | undefined,
): HeadlineInvestmentGrowthPresentation | null {
  if (!h) return null;
  const principalFullyRecovered = h.principalFullyRecovered === true;
  const roiPct = Number.isFinite(h.roi) ? h.roi * 100 : 0;
  const growthSar = Number.isFinite(h.totalGainLossSar) ? h.totalGainLossSar : 0;
  return {
    valueDisplay: principalFullyRecovered ? 'Principal recovered' : `${roiPct.toFixed(1)}%`,
    roiPct,
    presentValueSar: Number.isFinite(h.totalExposureSar) ? h.totalExposureSar : 0,
    netInvestedSar: Number.isFinite(h.netCapitalSar) ? h.netCapitalSar : 0,
    growthSar,
    depositsRecordedSar: Number.isFinite(h.depositsRecordedSar) ? h.depositsRecordedSar : 0,
    totalWithdrawnSar: Number.isFinite(h.totalWithdrawnSar) ? h.totalWithdrawnSar : 0,
    principalFullyRecovered,
    isGrowing: principalFullyRecovered || growthSar >= 0,
    statusLabel: principalFullyRecovered
      ? 'Principal recovered'
      : growthSar > 0.5
        ? 'Growing'
        : growthSar < -0.5
          ? 'Shrinking'
          : 'Flat',
    investmentAgeLabel: formatInvestmentAgeLabel(h.investmentAgeDays),
    firstCapitalDepositYmd: safeCapitalDepositYmd(h.firstCapitalDepositYmd),
    definition:
      h.capitalSource === 'mixed'
        ? describeInvestmentNetInvested('mixed')
        : h.capitalSource === 'cost_basis_fallback' || h.capitalSource === 'ledger_inferred'
          ? describeInvestmentNetInvested(h.capitalSource)
          : 'Present value minus net invested (deposits − withdrawals + commodity/Sukuk cost). Incomplete portfolios without deposit history floor at cost + cash so sibling market value is not free profit.',
  };
}

/** True when gain/loss, ROI, and daily P/L are internally consistent (same rollup object). */
export function headlineKpiMathIsConsistent(h: HeadlinePersonalInvestmentRoi): boolean {
  if (h.principalFullyRecovered) {
    return h.netCapitalSar <= HEADLINE_NEAR_ZERO_NET_INVESTED_SAR + 1e-9 && h.roi === 0;
  }
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
