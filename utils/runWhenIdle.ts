import {
  backgroundWorkPauseRemainingMs,
  isBackgroundWorkPaused,
} from './backgroundWorkGate';
import { yieldToMain } from './yieldToMain';

/** Serializes heavy idle tasks so they do not stack on one long main-thread block. */
let idleWorkChain: Promise<void> = Promise.resolve();

/** Test helper — drain queued idle work between assertions. */
export function resetIdleWorkQueueForTests(): void {
  idleWorkChain = Promise.resolve();
}

const MAX_PAUSE_WAIT_MS = 12_000;

/** Wait until input/route pause ends — idle work retries instead of being dropped. */
export async function waitUntilBackgroundWorkResumed(maxWaitMs = MAX_PAUSE_WAIT_MS): Promise<void> {
  const started = Date.now();
  while (isBackgroundWorkPaused()) {
    if (Date.now() - started >= maxWaitMs) return;
    const waitMs = Math.min(Math.max(backgroundWorkPauseRemainingMs(), 32), 400);
    await yieldToMain(waitMs);
  }
}

async function waitUntilBackgroundWorkResumedInternal(): Promise<void> {
  return waitUntilBackgroundWorkResumed();
}

function enqueueIdleWorkTask(work: () => void | Promise<void>): void {
  idleWorkChain = idleWorkChain
    .then(async () => {
      await waitUntilBackgroundWorkResumedInternal();
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
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const startWork = () => {
    if (cancelled) return;
    if (isBackgroundWorkPaused()) {
      const waitMs = Math.min(Math.max(backgroundWorkPauseRemainingMs(), 32), 500);
      retryTimer = setTimeout(startWork, waitMs);
      return;
    }
    enqueueIdleWorkTask(async () => {
      if (cancelled) return;
      await work();
    });
  };

  const scheduleStart = () => {
    if (typeof window === 'undefined') {
      startWork();
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
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
        if (retryTimer) clearTimeout(retryTimer);
        w.cancelIdleCallback?.(id);
      };
    }

    const t = window.setTimeout(onIdle, Math.min(timeoutMs, 32));
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.clearTimeout(t);
    };
  };

  return scheduleStart();
}
