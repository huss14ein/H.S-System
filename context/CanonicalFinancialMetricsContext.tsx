import React, { createContext, useContext, useMemo, useDeferredValue, useRef } from 'react';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketPrices } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import { pickDashboardCanonicalMetrics, type DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
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
  const { simulatedPrices } = useMarketPrices();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 1500);
  const deferredPrices = useDeferredValue(debouncedPrices);
  const debouncedData = useDebouncedValue(showHydrateBanner ? null : data, 350);
  const deferredData = useDeferredValue(debouncedData);
  useHydrateSarPerUsdDailySeries(deferredData, exchangeRate);

  const cachedValueRef = useRef<CanonicalFinancialMetricsContextValue | null>(null);

  const value = useMemo((): CanonicalFinancialMetricsContextValue => {
    if (isBackgroundWorkPaused() && cachedValueRef.current) {
      return cachedValueRef.current;
    }
    const full = buildCanonicalFinancialMetricsResult({
      data: deferredData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: deferredPrices,
      showHydrateBanner,
    });
    const dashboardCore = pickDashboardCanonicalMetrics(full);
    const next: CanonicalFinancialMetricsContextValue = {
      full,
      dashboard: {
        ...dashboardCore,
        data: deferredData,
        exchangeRate,
        simulatedPrices: deferredPrices,
        getAvailableCashForAccount,
      },
    };
    cachedValueRef.current = next;
    return next;
  }, [deferredData, exchangeRate, getAvailableCashForAccount, deferredPrices, showHydrateBanner]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
