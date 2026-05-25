import { useEffect } from 'react';
import type { FinancialData } from '../types';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';

/**
 * Persists the dense SAR/USD calendar map (localStorage). Must run in an effect, not during render/memo.
 */
export function useHydrateSarPerUsdDailySeries(
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): void {
  useEffect(() => {
    if (data == null) return;
    hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  }, [data, uiExchangeRate]);
}
