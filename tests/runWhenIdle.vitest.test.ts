import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  resetIdleWorkQueueForTests,
  scheduleIdleWork,
  scheduleIdleWorkAsync,
} from '../utils/runWhenIdle';
import { resetBackgroundWorkGateForTests } from '../utils/backgroundWorkGate';

describe('runWhenIdle', () => {
  beforeEach(() => {
    resetIdleWorkQueueForTests();
    resetBackgroundWorkGateForTests();
  });

  it('exports async scheduling alias for heavy work', () => {
    expect(typeof scheduleIdleWorkAsync).toBe('function');
    expect(typeof scheduleIdleWork).toBe('function');
  });

  it('runs queued idle tasks sequentially in node (no window)', async () => {
    const order: string[] = [];
    scheduleIdleWorkAsync(async () => {
      order.push('a');
    });
    scheduleIdleWorkAsync(async () => {
      order.push('b');
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a', 'b']);
  });

  it('retries idle work after a short input pause instead of dropping it', async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const { pauseBackgroundWork } = await import('../utils/backgroundWorkGate');
    pauseBackgroundWork(500);
    scheduleIdleWorkAsync(async () => {
      ran.push('done');
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(ran).toEqual(['done']);
    vi.useRealTimers();
  });

  it('cancel prevents queued work from running', async () => {
    const ran: string[] = [];
    const cancel = scheduleIdleWorkAsync(async () => {
      ran.push('x');
    });
    cancel();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual([]);
  });
});
