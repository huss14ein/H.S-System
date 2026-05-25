import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';
import { useCurrency } from '../context/CurrencyContext';
import { useMarketData } from '../context/MarketDataContext';
import type { FinancialData } from '../types';
import {
  computeCanonicalFinancialMetrics,
  type CanonicalFinancialMetrics,
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

/** Canonical personal NW + Dashboard KPI inputs (UI exchange rate + live quotes). */
export function useCanonicalFinancialMetrics(): UseCanonicalFinancialMetricsResult {
  const ctx = useContext(DataContext);
  const data = ctx?.data ?? null;
  const getAvailableCashForAccount = ctx?.getAvailableCashForAccount;
  const { exchangeRate } = useCurrency();
  const { simulatedPrices } = useMarketData();

  return useMemo((): UseCanonicalFinancialMetricsResult => {
    const metrics = computeCanonicalFinancialMetrics({
      data,
      exchangeRate,
      getAvailableCashForAccount,
      simulatedPrices,
    });
    const parts = metrics.headlineExposureParts;
    return {
      data,
      exchangeRate,
      simulatedPrices,
      getAvailableCashForAccount,
      ...metrics,
      buckets: metrics.headline.buckets,
      platformsRollupSar: parts.platformsRollupSar,
      commoditiesValueSar: parts.commoditiesValueSar,
      sukukAssetsValueSar: parts.sukukAssetsValueSar,
    };
  }, [data, exchangeRate, getAvailableCashForAccount, simulatedPrices]);
}
