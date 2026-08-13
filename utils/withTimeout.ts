/**
 * Bound a promise so a hung network/DB call cannot stall a FIFO queue forever.
 * The underlying work may still finish after reject — callers that mutate shared state
 * (e.g. lot FIFO writes) must guard late completions with a generation / allowWrite check.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const wait = Math.max(1, Number(ms) || 0);
  const name = String(label || 'operation').slice(0, 80);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${name} timed out after ${wait}ms`));
    }, wait);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
