import { isBackgroundWorkPaused } from './backgroundWorkGate';
import { yieldToMain } from './yieldToMain';

/** Serializes heavy idle tasks so they do not stack on one long main-thread block. */
let idleWorkChain: Promise<void> = Promise.resolve();

/** Test helper — drain queued idle work between assertions. */
export function resetIdleWorkQueueForTests(): void {
  idleWorkChain = Promise.resolve();
}

function enqueueIdleWorkTask(work: () => void | Promise<void>): void {
  idleWorkChain = idleWorkChain
    .then(async () => {
      if (isBackgroundWorkPaused()) return;
      await yieldToMain(0);
      if (isBackgroundWorkPaused()) return;
      await work();
    })
    .catch(() => {});
}

/**
 * Schedule work after paint without blocking navigation / hydrate.
 * requestIdleCallback only picks a start slot — work always runs on a later task.
 */
export function scheduleIdleWork(work: () => void, timeoutMs = 2000): () => void {
  return scheduleIdleWorkAsync(work, timeoutMs);
}

/** Async-friendly idle scheduling — use for multi-step or chunked background work. */
export function scheduleIdleWorkAsync(
  work: () => void | Promise<void>,
  timeoutMs = 2000,
): () => void {
  let cancelled = false;

  const startWork = () => {
    if (cancelled || isBackgroundWorkPaused()) return;
    enqueueIdleWorkTask(async () => {
      if (cancelled || isBackgroundWorkPaused()) return;
      await work();
    });
  };

  const scheduleStart = () => {
    if (typeof window === 'undefined') {
      startWork();
      return () => {
        cancelled = true;
      };
    }

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    /** Never run queued work inside the idle callback — keeps DevTools INP/rIC clean. */
    const onIdle = () => {
      window.setTimeout(startWork, 0);
    };

    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(onIdle, { timeout: timeoutMs });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }

    const t = window.setTimeout(onIdle, Math.min(timeoutMs, 32));
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  };

  return scheduleStart();
}
