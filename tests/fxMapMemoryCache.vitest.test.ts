/**
 * FX daily series in-memory map — avoids JSON.parse per transaction lookup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadSarPerUsdByDay,
  recordSarPerUsdForCalendarDay,
  getSarPerUsdForCalendarDay,
  clearFxMapMemoryCacheForTests,
} from '../services/fxDailySeries';

function mockLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
}

describe('fx map memory cache', () => {
  beforeEach(() => {
    mockLocalStorage();
    clearFxMapMemoryCacheForTests();
    localStorage.removeItem('finova_sar_per_usd_by_day_v1');
  });

  it('reuses in-memory map across getSarPerUsdForCalendarDay calls', () => {
    recordSarPerUsdForCalendarDay('2024-06-01', 3.75);
    const map = loadSarPerUsdByDay();
    const parseSpy = vi.spyOn(JSON, 'parse');
    getSarPerUsdForCalendarDay('2024-06-01', null, 3.75, map);
    getSarPerUsdForCalendarDay('2024-06-01', null, 3.75, map);
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('loadSarPerUsdByDay parses localStorage only once until save', () => {
    recordSarPerUsdForCalendarDay('2024-06-02', 3.76);
    clearFxMapMemoryCacheForTests();
    const parseSpy = vi.spyOn(JSON, 'parse');
    loadSarPerUsdByDay();
    loadSarPerUsdByDay();
    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });
});
