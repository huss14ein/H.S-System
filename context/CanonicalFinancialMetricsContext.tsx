import React, { createContext, useContext, useMemo, useEffect, useState, startTransition, useDeferredValue } from 'react';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketPrices } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import type { DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import { pickDashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import { extendCanonicalFinancialMetricsAsync } from '../services/canonicalFinancialMetricsAsync';
import { financialDataHasHydrated } from '../services/financialDataHydration';
import { yieldToMain } from '../utils/yieldToMain';
import {
  buildFastCanonicalFinancialMetricsResult,
  buildFromCanonicalMetrics,
  pickDashboardFromMetricsResult,
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

function buildContextValue(full: UseCanonicalFinancialMetricsResult): CanonicalFinancialMetricsContextValue {
  return {
    full,
    dashboard: pickDashboardFromMetricsResult(full),
  };
}

function buildEmptyContextValue(
  exchangeRate: number,
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number },
): CanonicalFinancialMetricsContextValue {
  return buildContextValue(
    buildFastCanonicalFinancialMetricsResult({
      data: null,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: {},
      showHydrateBanner: true,
    }),
  );
}

/** One canonical metrics bundle for the authenticated shell (fast sync paint, extended async). */
export function CanonicalFinancialMetricsProvider({ children }: { children: React.ReactNode }) {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const showHydrateBanner = ctx?.showHydrateBanner ?? false;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketPrices();
  const debouncedPrices = useDebouncedValue(simulatedPrices, 400);
  /** Let route transitions win over quote-driven KPI recomputes. */
  const deferredPrices = useDeferredValue(debouncedPrices);
  /** Live data for metrics — use partial/cached rows while fast tier hydrates; never block on full ledger. */
  const metricsData = showHydrateBanner && !financialDataHasHydrated(data) ? null : data;
  useHydrateSarPerUsdDailySeries(metricsData, exchangeRate);

  const fastBundle = useMemo((): UseCanonicalFinancialMetricsResult => {
    if (!metricsData) {
      return buildFastCanonicalFinancialMetricsResult({
        data: null,
        exchangeRate,
        getAvailableCashForAccount,
        debouncedPrices: deferredPrices,
        showHydrateBanner: true,
      });
    }
    return buildFastCanonicalFinancialMetricsResult({
      data: metricsData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: deferredPrices,
      showHydrateBanner: false,
    });
  }, [metricsData, exchangeRate, getAvailableCashForAccount, deferredPrices, showHydrateBanner]);

  const [extendedBundle, setExtendedBundle] = useState<UseCanonicalFinancialMetricsResult | null>(null);

  useEffect(() => {
    if (!metricsData) setExtendedBundle(null);
  }, [metricsData]);

  const extendedFingerprint = useMemo(
    () =>
      metricsData
        ? [
            metricsData.accounts?.length ?? 0,
            metricsData.transactions?.length ?? 0,
            metricsData.investmentTransactions?.length ?? 0,
            metricsData.investments?.length ?? 0,
            Object.keys(deferredPrices).length,
            exchangeRate,
          ].join(':')
        : '',
    [metricsData, deferredPrices, exchangeRate],
  );

  useEffect(() => {
    if (!metricsData) return;

    let aborted = false;
    const computeArgs = {
      data: metricsData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: deferredPrices,
      showHydrateBanner: false as const,
    };

    void (async () => {
      await yieldToMain(16);
      if (aborted) return;
      const dashboard = pickDashboardCanonicalMetrics(
        buildFastCanonicalFinancialMetricsResult({
          data: metricsData,
          exchangeRate,
          getAvailableCashForAccount,
          debouncedPrices: deferredPrices,
          showHydrateBanner: false,
        }),
      );
      const extended = await extendCanonicalFinancialMetricsAsync(
        dashboard,
        {
          data: metricsData,
          exchangeRate,
          getAvailableCashForAccount,
          simulatedPrices: deferredPrices,
        },
        { shouldAbort: () => aborted },
      );
      if (!extended || aborted) return;
      const full = buildFromCanonicalMetrics(computeArgs, extended, true);
      startTransition(() => setExtendedBundle(full));
    })();

    return () => {
      aborted = true;
    };
  }, [extendedFingerprint, metricsData, exchangeRate, getAvailableCashForAccount, deferredPrices]);

  const value = useMemo(() => {
    if (!metricsData) {
      return buildEmptyContextValue(exchangeRate, getAvailableCashForAccount);
    }
    const full = extendedBundle ?? fastBundle;
    return buildContextValue(full);
  }, [metricsData, fastBundle, extendedBundle, exchangeRate, getAvailableCashForAccount]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
