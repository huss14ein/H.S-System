import { describe, expect, it } from 'vitest';
import { withTimeout } from '../utils/withTimeout';

describe('withTimeout', () => {
  it('resolves when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'ok')).resolves.toBe(7);
  });

  it('rejects when the work hangs past the budget', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, 'Holdings ledger sync'),
    ).rejects.toThrow(/Holdings ledger sync timed out after 20ms/);
  });

  it('late completions after timeout must not mutate when allowWrite is false', async () => {
    let generation = 1;
    const allowWrite = () => generation === 1;
    const writes: string[] = [];
    let resolveSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });

    const raced = withTimeout(
      (async () => {
        await slow;
        if (!allowWrite()) return;
        writes.push('holding-write');
      })(),
      25,
      'Holdings ledger sync',
    );

    await expect(raced).rejects.toThrow(/timed out/);
    /** Mimic lotSyncGenerationRef bump after timeout abort. */
    generation += 1;
    resolveSlow?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toEqual([]);
  });
});
