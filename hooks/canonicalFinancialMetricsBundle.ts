import type { FinancialData } from '../types';
import {
  computeCanonicalFinancialMetrics,
  buildFastCanonicalFinancialMetrics,
  pickDashboardCanonicalMetrics,
  type CanonicalFinancialMetrics,
} from '../services/canonicalFinancialMetrics';
import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';

export type UseCanonicalFinancialMetricsResult = CanonicalFinancialMetrics & {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices: SimulatedPriceMap;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  buckets: CanonicalFinancialMetrics['headline']['buckets'];
  platformsRollupSar: number;
  commoditiesValueSar: number;
  sukukAssetsValueSar: number;
  /** True once phase-2 wealth summary / allocation has been merged. */
  metricsExtendedReady: boolean;
};

function wrapMetricsResult(
  args: {
    data: FinancialData | null;
    exchangeRate: number;
    getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
    debouncedPrices: SimulatedPriceMap;
    showHydrateBanner: boolean;
  },
  metrics: CanonicalFinancialMetrics,
  metricsExtendedReady: boolean,
): UseCanonicalFinancialMetricsResult {
  const { data, exchangeRate, getAvailableCashForAccount, debouncedPrices } = args;
  const parts = metrics.headlineExposureParts;
  return {
    data,
    exchangeRate,
    simulatedPrices: debouncedPrices,
    getAvailableCashForAccount,
    ...metrics,
    buckets: metrics.headline.buckets,
    platformsRollupSar: parts.platformsRollupSar,
    commoditiesValueSar: parts.commoditiesValueSar,
    sukukAssetsValueSar: parts.sukukAssetsValueSar,
    metricsExtendedReady,
  };
}

export function buildFastCanonicalFinancialMetricsResult(args: {
  data: FinancialData | null;
  exchangeRate: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  debouncedPrices: SimulatedPriceMap;
  showHydrateBanner: boolean;
}): UseCanonicalFinancialMetricsResult {
  const { data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner } = args;
  const metrics = buildFastCanonicalFinancialMetrics({
    data: showHydrateBanner ? null : data,
    exchangeRate,
    getAvailableCashForAccount: showHydrateBanner ? undefined : getAvailableCashForAccount,
    simulatedPrices: showHydrateBanner ? {} : debouncedPrices,
  });
  return wrapMetricsResult(args, metrics, false);
}

export function buildFromCanonicalMetrics(
  args: {
    data: FinancialData | null;
    exchangeRate: number;
    getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
    debouncedPrices: SimulatedPriceMap;
    showHydrateBanner: boolean;
  },
  metrics: CanonicalFinancialMetrics,
  metricsExtendedReady: boolean,
): UseCanonicalFinancialMetricsResult {
  return wrapMetricsResult(args, metrics, metricsExtendedReady);
}

export function buildCanonicalFinancialMetricsResult(args: {
  data: FinancialData | null;
  exchangeRate: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  debouncedPrices: SimulatedPriceMap;
  showHydrateBanner: boolean;
}): UseCanonicalFinancialMetricsResult {
  const { data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner } = args;
  const metrics = computeCanonicalFinancialMetrics({
    data: showHydrateBanner ? null : data,
    exchangeRate,
    getAvailableCashForAccount: showHydrateBanner ? undefined : getAvailableCashForAccount,
    simulatedPrices: showHydrateBanner ? {} : debouncedPrices,
  });
  return wrapMetricsResult(args, metrics, true);
}

/** Derive dashboard bundle from full canonical metrics (avoids duplicate headline/KPI compute). */
export function pickDashboardFromMetricsResult(
  full: UseCanonicalFinancialMetricsResult,
): ReturnType<typeof pickDashboardCanonicalMetrics> & {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices: SimulatedPriceMap;
  getAvailableCashForAccount?: UseCanonicalFinancialMetricsResult['getAvailableCashForAccount'];
} {
  return {
    ...pickDashboardCanonicalMetrics(full),
    data: full.data,
    exchangeRate: full.exchangeRate,
    simulatedPrices: full.simulatedPrices,
    getAvailableCashForAccount: full.getAvailableCashForAccount,
  };
}
