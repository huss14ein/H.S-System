import { useEffect, useRef, useState, startTransition } from 'react';
import { scheduleIdleWorkAsync, waitUntilBackgroundWorkResumed } from '../utils/runWhenIdle';
import { yieldToMain } from '../utils/yieldToMain';

export type DeferredIdleComputeResult<T> = {
  value: T;
  /** True after a successful compute while enabled; false while empty/loading or after failure. */
  ready: boolean;
  error: Error | null;
};

/** Defer expensive pure compute off the render path (idle + transition). */
export function useDeferredIdleCompute<T>(args: {
  enabled: boolean;
  empty: T;
  compute: () => T;
  deps: readonly unknown[];
  idleMs?: number;
}): DeferredIdleComputeResult<T> {
  const { enabled, empty, compute, deps, idleMs = 350 } = args;
  const [value, setValue] = useState<T>(empty);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const computeRef = useRef(compute);
  computeRef.current = compute;

  useEffect(() => {
    if (!enabled) {
      setValue(empty);
      setReady(false);
      setError(null);
      return;
    }
    let aborted = false;
    setReady(false);
    setError(null);
    const cancel = scheduleIdleWorkAsync(async () => {
      // Wait out nav/input pause — do not drop compute (stale empty would stick).
      await waitUntilBackgroundWorkResumed();
      if (aborted) return;
      await yieldToMain(0);
      if (aborted) return;
      try {
        const next = computeRef.current();
        if (aborted) return;
        startTransition(() => {
          setValue(next);
          setReady(true);
          setError(null);
        });
      } catch (err) {
        if (aborted) return;
        const wrapped = err instanceof Error ? err : new Error(String(err));
        console.error('useDeferredIdleCompute failed:', wrapped);
        startTransition(() => {
          setValue(empty);
          setReady(false);
          setError(wrapped);
        });
      }
    }, idleMs);

    return () => {
      aborted = true;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies stable dep list
  }, [enabled, idleMs, empty, ...deps]);

  return { value, ready, error };
}
