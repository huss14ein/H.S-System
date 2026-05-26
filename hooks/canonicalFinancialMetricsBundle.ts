import type { FinancialData } from '../types';
import {
  computeCanonicalFinancialMetrics,
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
};

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
  };
}
