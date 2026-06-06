import { startTransition, useEffect, useState } from 'react';
import { netWorthSparklineFromSnapshots } from '../services/executiveKpiSparklines';
import { scheduleIdleWorkAsync } from '../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../utils/backgroundWorkGate';

const EMPTY_NW: number[] = [];

/** NW snapshot sparkline deferred so Wealth Analytics hero paints first. */
export function useExecutiveKpiSparklines(enabled: boolean): number[] {
  const [nwSparkline, setNwSparkline] = useState(EMPTY_NW);

  useEffect(() => {
    if (!enabled) {
      setNwSparkline(EMPTY_NW);
      return;
    }
    return scheduleIdleWorkAsync(async () => {
      if (isBackgroundWorkPaused()) return;
      const spark = netWorthSparklineFromSnapshots();
      startTransition(() => setNwSparkline(spark));
    }, 150);
  }, [enabled]);

  return nwSparkline;
}
