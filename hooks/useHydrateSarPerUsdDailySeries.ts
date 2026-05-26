import { useContext, useEffect, useRef } from 'react';
import type { FinancialData } from '../types';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { DataContext } from '../context/DataContext';

/**
 * Persists the dense SAR/USD calendar map (localStorage). Must run in an effect, not during render/memo.
 * Dedupes by `dataResetKey` so N components mounting spot FX do not rewrite localStorage N times per tick.
 */
export function useHydrateSarPerUsdDailySeries(
  data: FinancialData | null | undefined,
  uiExchangeRate: number,
): void {
  const dataResetKey = useContext(DataContext)?.dataResetKey ?? 0;
  const lastHydratedKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (data == null) return;
    if (lastHydratedKeyRef.current === dataResetKey) return;
    lastHydratedKeyRef.current = dataResetKey;
    hydrateSarPerUsdDailySeries(data, uiExchangeRate);
  }, [data, uiExchangeRate, dataResetKey]);
}
