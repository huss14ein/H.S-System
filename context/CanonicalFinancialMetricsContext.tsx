import React, { createContext, useContext, useMemo, useEffect, useState, startTransition } from 'react';
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
  overlayLiveQuoteTierOntoExtendedMetrics,
  pickDashboardFromMetricsResult,
  type UseCanonicalFinancialMetricsResult,
} from '../hooks/canonicalFinancialMetricsBundle';

import type { SimulatedPriceMap } from '../services/investmentPlatformCardMetrics';

function compactQuotePriceFingerprint(prices: SimulatedPriceMap): string {
  return Object.entries(prices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sym, row]) => {
      const p = Math.round((row?.price ?? 0) * 100);
      const c = Math.round((row?.change ?? 0) * 100);
      return `${sym}:${p}:${c}`;
    })
    .join('|');
}

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
  /** Responsive KPI recompute — single debounce aligned with live quote ticks. */
  const kpiQuotePrices = useDebouncedValue(simulatedPrices, 250);
  /** Fast-tier KPIs use live session quotes once financial data has hydrated — not only phase-2 async. */
  const metricsData = data && financialDataHasHydrated(data) ? data : null;
  useHydrateSarPerUsdDailySeries(metricsData, exchangeRate);

  const fastBundle = useMemo((): UseCanonicalFinancialMetricsResult => {
    if (!metricsData) {
      return buildFastCanonicalFinancialMetricsResult({
        data: null,
        exchangeRate,
        getAvailableCashForAccount,
        debouncedPrices: kpiQuotePrices,
        showHydrateBanner: true,
      });
    }
    return buildFastCanonicalFinancialMetricsResult({
      data: metricsData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: kpiQuotePrices,
      showHydrateBanner: false,
    });
  }, [metricsData, exchangeRate, getAvailableCashForAccount, kpiQuotePrices, showHydrateBanner]);

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
            Object.keys(kpiQuotePrices).length,
            compactQuotePriceFingerprint(kpiQuotePrices),
            exchangeRate,
          ].join(':')
        : '',
    [metricsData, kpiQuotePrices, exchangeRate],
  );

  useEffect(() => {
    if (!metricsData) return;

    let aborted = false;
    const computeArgs = {
      data: metricsData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: kpiQuotePrices,
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
          debouncedPrices: kpiQuotePrices,
          showHydrateBanner: false,
        }),
      );
      const extended = await extendCanonicalFinancialMetricsAsync(
        dashboard,
        {
          data: metricsData,
          exchangeRate,
          getAvailableCashForAccount,
          simulatedPrices: kpiQuotePrices,
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
  }, [extendedFingerprint, metricsData, exchangeRate, getAvailableCashForAccount, kpiQuotePrices]);

  const value = useMemo(() => {
    if (!metricsData) {
      return buildEmptyContextValue(exchangeRate, getAvailableCashForAccount);
    }
    const full = extendedBundle
      ? overlayLiveQuoteTierOntoExtendedMetrics(extendedBundle, fastBundle)
      : fastBundle;
    return buildContextValue(full);
  }, [metricsData, fastBundle, extendedBundle, exchangeRate, getAvailableCashForAccount]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
