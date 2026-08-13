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
});
