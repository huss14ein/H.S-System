import { useContext, useEffect, useRef } from 'react';
import type { FinancialData } from '../types';
import { hydrateSarPerUsdDailySeries } from '../services/fxDailySeries';
import { DataContext } from '../context/DataContext';
import { scheduleIdleWork } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';

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

    return scheduleIdleWork(() => {
      if (isBackgroundWorkPaused()) return;
      lastHydratedKeyRef.current = hydrateKey;
      hydrateSarPerUsdDailySeries(data, uiExchangeRate, opts);
    }, 900);
  }, [data, uiExchangeRate, dataResetKey, optsKey, opts]);
}
