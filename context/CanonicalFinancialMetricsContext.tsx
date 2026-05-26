import React, { createContext, useContext, useMemo } from 'react';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketData } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import { computeDashboardCanonicalMetrics, type DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import {
  buildCanonicalFinancialMetricsResult,
  type UseCanonicalFinancialMetricsResult,
} from '../hooks/canonicalFinancialMetricsBundle';

type CanonicalFinancialMetricsContextValue = {
  full: UseCanonicalFinancialMetricsResult;
  dashboard: DashboardCanonicalMetrics & {
    data: UseCanonicalFinancialMetricsResult['data'];
    exchangeRate: number;
    simulatedPrices: UseCanonicalFinancialMetricsResult['simulatedPrices'];
    getAvailableCashForAccount?: UseCanonicalFinancialMetricsResult['getAvailableCashForAccount'];
  };
};

const CanonicalFinancialMetricsContext = createContext<CanonicalFinancialMetricsContextValue | null>(null);

/** One canonical metrics bundle for the authenticated shell (avoids N× recompute per page). */
export function CanonicalFinancialMetricsProvider({ children }: { children: React.ReactNode }) {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 400);
  useHydrateSarPerUsdDailySeries(data, exchangeRate);

  const value = useMemo((): CanonicalFinancialMetricsContextValue => {
    const full = buildCanonicalFinancialMetricsResult({
      data,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices,
      showHydrateBanner,
    });
    const dashboardCore = computeDashboardCanonicalMetrics({
      data: showHydrateBanner ? null : data,
      exchangeRate,
      getAvailableCashForAccount: showHydrateBanner ? undefined : getAvailableCashForAccount,
      simulatedPrices: showHydrateBanner ? {} : debouncedPrices,
    });
    return {
      full,
      dashboard: {
        ...dashboardCore,
        data,
        exchangeRate,
        simulatedPrices: debouncedPrices,
        getAvailableCashForAccount,
      },
    };
  }, [data, exchangeRate, getAvailableCashForAccount, debouncedPrices, showHydrateBanner]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
