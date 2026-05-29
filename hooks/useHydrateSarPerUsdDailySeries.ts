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
  opts?: { horizonDays?: number; earliestCalendarDay?: string },
): void {
  const dataResetKey = useContext(DataContext)?.dataResetKey ?? 0;
  const lastHydratedKeyRef = useRef<string | null>(null);
  const optsKey = opts ? `${opts.horizonDays ?? ''}:${opts.earliestCalendarDay ?? ''}` : '';

  useEffect(() => {
    if (data == null) return;
    const hydrateKey = `${dataResetKey}:${optsKey}`;
    if (lastHydratedKeyRef.current === hydrateKey) return;
    lastHydratedKeyRef.current = hydrateKey;
    hydrateSarPerUsdDailySeries(data, uiExchangeRate, opts);
  }, [data, uiExchangeRate, dataResetKey, optsKey, opts]);
}
