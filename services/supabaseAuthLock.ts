/**
 * Supabase GoTrue uses the Web Locks API by default. React Strict Mode (dev) and rapid
 * auth listeners can orphan locks and stall session reads for 5s+ — use a simple mutex instead.
 */
let authLockChain: Promise<void> = Promise.resolve();

export async function supabaseAuthLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const run = authLockChain.then(() => fn());
  authLockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
