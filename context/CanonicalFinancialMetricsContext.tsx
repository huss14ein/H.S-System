import React, { createContext, useContext, useMemo, useDeferredValue, useRef, useEffect, useState, startTransition } from 'react';
import type { FinancialData } from '../types';
import { DataContext } from './DataContext';
import { useCurrency } from './CurrencyContext';
import { useMarketPrices } from './MarketDataContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useHydrateSarPerUsdDailySeries } from '../hooks/useHydrateSarPerUsdDailySeries';
import { pickDashboardCanonicalMetrics, type DashboardCanonicalMetrics } from '../services/canonicalFinancialMetrics';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';
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

function buildContextValue(args: {
  data: FinancialData | null;
  exchangeRate: number;
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number };
  debouncedPrices: UseCanonicalFinancialMetricsResult['simulatedPrices'];
  showHydrateBanner: boolean;
}): CanonicalFinancialMetricsContextValue {
  const full = buildCanonicalFinancialMetricsResult({
    data: args.data,
    exchangeRate: args.exchangeRate,
    getAvailableCashForAccount: args.getAvailableCashForAccount,
    debouncedPrices: args.debouncedPrices,
    showHydrateBanner: args.showHydrateBanner,
  });
  const dashboardCore = pickDashboardCanonicalMetrics(full);
  return {
    full,
    dashboard: {
      ...dashboardCore,
      data: args.data,
      exchangeRate: args.exchangeRate,
      simulatedPrices: args.debouncedPrices,
      getAvailableCashForAccount: args.getAvailableCashForAccount,
    },
  };
}

function buildEmptyContextValue(
  exchangeRate: number,
  getAvailableCashForAccount?: (accountId: string) => { SAR: number; USD: number },
): CanonicalFinancialMetricsContextValue {
  return buildContextValue({
    data: null,
    exchangeRate,
    getAvailableCashForAccount,
    debouncedPrices: {},
    showHydrateBanner: true,
  });
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

    const applyCompute = () => {
      const next = buildContextValue(computeArgs);
      valueRef.current = next;
      startTransition(() => setValue(next));
    };

    const isFirstPaintWithData = !valueRef.current.full.data;
    if (isFirstPaintWithData && !isBackgroundWorkPaused()) {
      applyCompute();
      return () => {
        aborted = true;
      };
    }

    const cancelIdle = scheduleIdleWorkAsync(async () => {
      if (aborted || isBackgroundWorkPaused()) return;
      await yieldToMain(16);
      if (aborted || isBackgroundWorkPaused()) return;
      applyCompute();
    }, 500);

    return () => {
      aborted = true;
      cancelIdle();
    };
  }, [fingerprint, deferredData, exchangeRate, getAvailableCashForAccount, deferredPrices, showHydrateBanner]);

  return (
    <CanonicalFinancialMetricsContext.Provider value={value}>{children}</CanonicalFinancialMetricsContext.Provider>
  );
}

export function useCanonicalFinancialMetricsContext(): CanonicalFinancialMetricsContextValue | null {
  return useContext(CanonicalFinancialMetricsContext);
}
