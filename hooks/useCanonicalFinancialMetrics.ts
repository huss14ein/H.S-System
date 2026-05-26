import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketData } from '../context/MarketDataContext';
import { useCanonicalFinancialMetricsContext } from '../context/CanonicalFinancialMetricsContext';
import type { FinancialData } from '../types';
import { resolveSarPerUsd } from '../utils/currencyMath';
import { useDebouncedValue } from './useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from './useHydrateSarPerUsdDailySeries';
import { computeDashboardCanonicalMetrics, type DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import {
  buildCanonicalFinancialMetricsResult,
  type UseCanonicalFinancialMetricsResult,
} from './canonicalFinancialMetricsBundle';

export type { CanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
export type { UseCanonicalFinancialMetricsResult } from './canonicalFinancialMetricsBundle';
export { buildCanonicalFinancialMetricsResult } from './canonicalFinancialMetricsBundle';

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

/** Isolated renders / unit tests without AuthenticatedAppShell. */
export function useCanonicalFinancialMetricsLocal(): UseCanonicalFinancialMetricsResult {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 400);
  useHydrateSarPerUsdDailySeries(data, exchangeRate);

  return useMemo(
    () =>
      buildCanonicalFinancialMetricsResult({
        data,
        exchangeRate,
        getAvailableCashForAccount,
        debouncedPrices,
        showHydrateBanner,
      }),
    [data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner],
  );
}

/** Canonical personal NW + KPI — reads shell provider (one compute per quote tick). */
export function useCanonicalFinancialMetrics(): UseCanonicalFinancialMetricsResult {
  const shell = useCanonicalFinancialMetricsContext();
  if (shell) return shell.full;
  return useCanonicalFinancialMetricsLocal();
}

/** Isolated dashboard metrics without shell provider. */
export function useDashboardCanonicalMetricsLocal(): DashboardCanonicalMetrics & {
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
    const metrics = computeDashboardCanonicalMetrics({
      data: showHydrateBanner ? null : data,
      exchangeRate,
      getAvailableCashForAccount: showHydrateBanner ? undefined : getAvailableCashForAccount,
      simulatedPrices: showHydrateBanner ? {} : debouncedPrices,
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

/** Dashboard-weight metrics — reads shell provider when available. */
export function useDashboardCanonicalMetrics(): DashboardCanonicalMetrics & {
  data: FinancialData | null;
  exchangeRate: number;
  simulatedPrices: Record<string, { price: number; change?: number; changePercent?: number }>;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
} {
  const shell = useCanonicalFinancialMetricsContext();
  if (shell) return shell.dashboard;
  return useDashboardCanonicalMetricsLocal();
}
