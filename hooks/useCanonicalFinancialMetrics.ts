import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketData } from '../context/MarketDataContext';
import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { useDebouncedValue } from './useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from './useHydrateSarPerUsdDailySeries';
import {
  computeCanonicalFinancialMetrics,
  computeDashboardCanonicalMetrics,
  type CanonicalFinancialMetrics,
  type DashboardCanonicalMetrics,
} from '../services/canonicalFinancialMetrics';

export type { CanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';

export type UseCanonicalFinancialMetricsResult = CanonicalFinancialMetrics & {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices: Record<string, { price: number; change?: number; changePercent?: number }>;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  buckets: CanonicalFinancialMetrics['headline']['buckets'];
  platformsRollupSar: number;
  commoditiesValueSar: number;
  sukukAssetsValueSar: number;
};

/**
 * Headline SAR/USD spot only (hydrates daily FX series). Use in Header / notifications
 * instead of the full canonical bundle so quote ticks do not block the UI thread.
 */
export function useCanonicalSpotFx(): number {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const { exchangeRate } = useCurrency();
  useHydrateSarPerUsdDailySeries(data, exchangeRate);
  return useMemo(() => {
    if (!data) return exchangeRate;
    return resolveSarPerUsd(data, exchangeRate);
  }, [data, exchangeRate]);
}

/** Canonical personal NW + Dashboard KPI inputs (UI exchange rate + live quotes). */
export function useCanonicalFinancialMetrics(): UseCanonicalFinancialMetricsResult {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 400);
  useHydrateSarPerUsdDailySeries(data, exchangeRate);

  return useMemo((): UseCanonicalFinancialMetricsResult => {
    if (showHydrateBanner) {
      const metrics = computeCanonicalFinancialMetrics({
        data: null,
        exchangeRate,
        getAvailableCashForAccount: undefined,
        simulatedPrices: {},
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
    const metrics = computeCanonicalFinancialMetrics({
      data,
      exchangeRate,
      getAvailableCashForAccount,
      simulatedPrices: debouncedPrices,
    });
    const parts = metrics.headlineExposureParts;
    return {
      data,
      exchangeRate,
      /** Same map passed into `computeCanonicalFinancialMetrics` (debounced live quotes). */
      simulatedPrices: debouncedPrices,
      getAvailableCashForAccount,
      ...metrics,
      buckets: metrics.headline.buckets,
      platformsRollupSar: parts.platformsRollupSar,
      commoditiesValueSar: parts.commoditiesValueSar,
      sukukAssetsValueSar: parts.sukukAssetsValueSar,
    };
  }, [data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner]);
}

/** Lighter than full canonical bundle — use on Dashboard to avoid wealth-summary work on every quote tick. */
export function useDashboardCanonicalMetrics(): DashboardCanonicalMetrics & {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices: Record<string, { price: number; change?: number; changePercent?: number }>;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
} {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 400);
  useHydrateSarPerUsdDailySeries(data, exchangeRate);

  return useMemo(() => {
    if (showHydrateBanner) {
      return {
        data,
        exchangeRate,
        simulatedPrices: debouncedPrices,
        getAvailableCashForAccount,
        ...computeDashboardCanonicalMetrics({
          data: null,
          exchangeRate,
          getAvailableCashForAccount: undefined,
          simulatedPrices: {},
        }),
      };
    }
    const metrics = computeDashboardCanonicalMetrics({
      data,
      exchangeRate,
      getAvailableCashForAccount,
      simulatedPrices: debouncedPrices,
    });
    return {
      data,
      exchangeRate,
      simulatedPrices: debouncedPrices,
      getAvailableCashForAccount,
      ...metrics,
    };
  }, [data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner]);
}
