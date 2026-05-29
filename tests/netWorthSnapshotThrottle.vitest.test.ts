import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  markAutoNetWorthSnapshotCaptured,
  shouldThrottleAutoNetWorthSnapshot,
} from '../services/netWorthSnapshotThrottle';

function mockSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

describe('netWorthSnapshotThrottle', () => {
  const userId = 'test-user-throttle';

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', mockSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throttle before first capture', () => {
    expect(shouldThrottleAutoNetWorthSnapshot(userId, 1_000_000)).toBe(false);
  });

  it('throttles within session window when NW unchanged', () => {
    markAutoNetWorthSnapshotCaptured(userId, 1_000_000);
    expect(shouldThrottleAutoNetWorthSnapshot(userId, 1_000_000)).toBe(true);
  });

  it('allows capture when NW moves materially', () => {
    markAutoNetWorthSnapshotCaptured(userId, 1_000_000);
    expect(shouldThrottleAutoNetWorthSnapshot(userId, 1_006_000)).toBe(false);
  });
});
