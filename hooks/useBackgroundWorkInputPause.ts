import { useEffect } from 'react';
import { pauseBackgroundWork, INPUT_INTERACTION_PAUSE_MS } from '../utils/backgroundWorkGate';

/**
 * Pause deferred metrics / idle compute while the user types or clicks in the app shell.
 * Scroll (wheel) is intentionally excluded — scrolling Wealth Analytics must not cancel mounts.
 */
export function useBackgroundWorkInputPause(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const pause = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-nav-link], [data-skip-background-pause], [role="dialog"]')) return;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      pauseBackgroundWork(INPUT_INTERACTION_PAUSE_MS);
    };

    window.addEventListener('keydown', pause, { capture: true, passive: true });
    window.addEventListener('pointerdown', pause, { capture: true, passive: true });

    return () => {
      window.removeEventListener('keydown', pause, { capture: true });
      window.removeEventListener('pointerdown', pause, { capture: true });
    };
  }, [enabled]);
}
