import { useEffect } from 'react';
import { pauseBackgroundWork } from '../utils/backgroundWorkGate';

const INPUT_PAUSE_MS = 4_000;

/**
 * Pause deferred metrics / idle compute while the user types or clicks in the app shell.
 * Prevents multi-minute P/L jobs from starving keyboard INP on main content.
 */
export function useBackgroundWorkInputPause(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const pause = () => pauseBackgroundWork(INPUT_PAUSE_MS);

    window.addEventListener('keydown', pause, { capture: true, passive: true });
    window.addEventListener('pointerdown', pause, { capture: true, passive: true });
    window.addEventListener('wheel', pause, { capture: true, passive: true });

    return () => {
      window.removeEventListener('keydown', pause, { capture: true });
      window.removeEventListener('pointerdown', pause, { capture: true });
      window.removeEventListener('wheel', pause, { capture: true });
    };
  }, [enabled]);
}
