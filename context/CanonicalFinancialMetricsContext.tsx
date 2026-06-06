import React, { createContext, useContext, useMemo, useDeferredValue, useRef, useEffect, useState, startTransition } from 'react';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketPrices } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import type { DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import { pickDashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import type { CanonicalFinancialMetrics } from '../services/canonicalFinancialMetrics';
import { extendCanonicalFinancialMetricsAsync } from '../services/canonicalFinancialMetricsAsync';
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

/** One canonical metrics bundle for the authenticated shell (idle recompute — keeps input responsive). */
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

  const valueRef = useRef<CanonicalFinancialMetricsContextValue>(
    buildEmptyContextValue(exchangeRate, getAvailableCashForAccount),
  );
  const [value, setValue] = useState<CanonicalFinancialMetricsContextValue>(() => valueRef.current);

  const fingerprint = useMemo(
    () =>
      [
        showHydrateBanner ? '1' : '0',
        deferredData?.accounts?.length ?? 0,
        deferredData?.transactions?.length ?? 0,
        deferredData?.investmentTransactions?.length ?? 0,
        deferredData?.investments?.length ?? 0,
        Object.keys(deferredPrices).length,
        exchangeRate,
      ].join(':'),
    [deferredData, deferredPrices, exchangeRate, showHydrateBanner],
  );

  useEffect(() => {
    if (showHydrateBanner || !deferredData) {
      const empty = buildEmptyContextValue(exchangeRate, getAvailableCashForAccount);
      valueRef.current = empty;
      startTransition(() => setValue(empty));
      return;
    }

    let aborted = false;
    const computeArgs = {
      data: deferredData,
      exchangeRate,
      getAvailableCashForAccount,
      debouncedPrices: deferredPrices,
      showHydrateBanner: false,
    };

    const applyFast = () => {
      const fast = buildFastCanonicalFinancialMetricsResult(computeArgs);
      valueRef.current = buildContextValue(fast);
      startTransition(() => setValue(valueRef.current));
    };

    const applyExtended = (metrics: CanonicalFinancialMetrics) => {
      const full = buildFromCanonicalMetrics(computeArgs, metrics, true);
      valueRef.current = buildContextValue(full);
      startTransition(() => setValue(valueRef.current));
    };

    applyFast();

    void (async () => {
      await yieldToMain(16);
      if (aborted) return;
      const dashboard = pickDashboardCanonicalMetrics(valueRef.current.full);
      const extended = await extendCanonicalFinancialMetricsAsync(
        dashboard,
        {
          data: deferredData,
          exchangeRate,
          getAvailableCashForAccount,
          simulatedPrices: deferredPrices,
        },
        { shouldAbort: () => aborted },
      );
      if (!extended || aborted) return;
      applyExtended(extended);
    })();

    return () => {
      aborted = true;
    };
  }, [fingerprint, deferredData, exchangeRate, getAvailableCashForAccount, deferredPrices, showHydrateBanner]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
