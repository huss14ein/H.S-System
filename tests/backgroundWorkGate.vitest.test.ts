import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pauseBackgroundWork,
  isBackgroundWorkPaused,
  backgroundWorkPauseRemainingMs,
  resetBackgroundWorkGateForTests,
} from '../utils/backgroundWorkGate';

describe('backgroundWorkGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBackgroundWorkGateForTests();
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses background work for the requested window', () => {
    pauseBackgroundWork(500);
    expect(isBackgroundWorkPaused()).toBe(true);
    expect(backgroundWorkPauseRemainingMs()).toBeGreaterThan(0);
    vi.advanceTimersByTime(600);
    expect(isBackgroundWorkPaused()).toBe(false);
  });

  it('extends pause when called again within the window', () => {
    pauseBackgroundWork(200);
    vi.advanceTimersByTime(150);
    pauseBackgroundWork(500);
    vi.advanceTimersByTime(300);
    expect(isBackgroundWorkPaused()).toBe(true);
    vi.advanceTimersByTime(400);
    expect(isBackgroundWorkPaused()).toBe(false);
  });
});
