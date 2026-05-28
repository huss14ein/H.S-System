import React, { createContext, useContext, useMemo, useDeferredValue } from 'react';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketData } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import { pickDashboardCanonicalMetrics, type DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
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
  const debouncedPrices = useDebouncedValue(simulatedPrices, 1500);
  const deferredPrices = useDeferredValue(debouncedPrices);
  const deferredData = useDeferredValue(showHydrateBanner ? null : data);
  useHydrateSarPerUsdDailySeries(deferredData, exchangeRate);

  const value = useMemo((): CanonicalFinancialMetricsContextValue => {
    const full = buildCanonicalFinancialMetricsResult({
      data: deferredData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: deferredPrices,
      showHydrateBanner,
    });
    const dashboardCore = pickDashboardCanonicalMetrics(full);
    return {
      full,
      dashboard: {
        ...dashboardCore,
        data: deferredData,
        exchangeRate,
        simulatedPrices: deferredPrices,
        getAvailableCashForAccount,
      },
    };
  }, [deferredData, exchangeRate, getAvailableCashForAccount, deferredPrices, showHydrateBanner]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
