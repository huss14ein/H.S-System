import { describe, expect, it } from 'vitest';
import {
  computeFibonacciLevels,
  detectLatestDowntrendSwing,
  evaluateFibonacciRetracement,
  formatFibForAiGrounding,
  formatFibSignalShort,
  shouldNotifyFibZoneEntry,
} from '../services/fibonacciAnalysis';

/** Synthetic downtrend then retrace into 0.618–0.786 zone (clear unique swing high/low). */
function buildDowntrendThenRetrace(): number[] {
  // Rise to unique peak 120, drop to unique trough 80, retrace into ~104.7–111.4 zone.
  return [
    95, 96, 97, 98, 99, 100, 105, 110, 115, 118, 120, // peak at 120
    115, 110, 105, 100, 95, 90, 85, 82, 80, // trough at 80
    82, 85, 90, 95, 100, 105, 108, 109,
  ];
}

describe('fibonacciAnalysis', () => {
  it('computes downtrend levels Low + (High−Low)×ratio (0 at trough, 0.786 near peak)', () => {
    const levels = computeFibonacciLevels(120, 80, 'downtrend');
    expect(levels.find((l) => l.ratio === 0)?.price).toBeCloseTo(80, 5);
    expect(levels.find((l) => l.ratio === 1)?.price).toBeCloseTo(120, 5);
    expect(levels.find((l) => l.ratio === 0.618)?.price).toBeCloseTo(80 + 40 * 0.618, 5);
    expect(levels.find((l) => l.ratio === 0.786)?.price).toBeCloseTo(80 + 40 * 0.786, 5);
    // 0.786 is closer to the peak than 0.618 (infographic order).
    expect(levels.find((l) => l.ratio === 0.786)!.price).toBeGreaterThan(
      levels.find((l) => l.ratio === 0.618)!.price,
    );
  });

  it('detects a downtrend swing and flags reversal zone', () => {
    const prices = buildDowntrendThenRetrace();
    const swing = detectLatestDowntrendSwing(prices, { lookback: 2, minDropPct: 0.05 });
    expect(swing).not.toBeNull();
    expect(swing!.high.price).toBeGreaterThan(swing!.low.price);

    const analysis = evaluateFibonacciRetracement(prices, { preferDirection: 'downtrend', lookback: 2 });
    expect(analysis).not.toBeNull();
    expect(analysis!.direction).toBe('downtrend');
    expect(analysis!.reversalZone.high).toBeGreaterThan(analysis!.reversalZone.low);
    expect(analysis!.inReversalZone).toBe(true);
    expect(formatFibSignalShort(analysis)).toMatch(/Fib zone/i);
    expect(formatFibForAiGrounding('TEST', analysis)).toMatch(/61\.8%|0\.618/);
  });

  it('dedupes zone-entry notifications per symbol/day', () => {
    const prices = buildDowntrendThenRetrace();
    const analysis = evaluateFibonacciRetracement(prices, { preferDirection: 'downtrend', lookback: 2 });
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    expect(shouldNotifyFibZoneEntry(analysis, 'AAPL', storage)).toBe(true);
    expect(shouldNotifyFibZoneEntry(analysis, 'AAPL', storage)).toBe(false);
    expect(shouldNotifyFibZoneEntry(analysis, 'MSFT', storage)).toBe(true);
  });

  it('computes uptrend levels High − (High−Low)×ratio (0 at peak, 0.786 near trough)', () => {
    const levels = computeFibonacciLevels(120, 80, 'uptrend');
    expect(levels.find((l) => l.ratio === 0)?.price).toBeCloseTo(120, 5);
    expect(levels.find((l) => l.ratio === 1)?.price).toBeCloseTo(80, 5);
    expect(levels.find((l) => l.ratio === 0.618)?.price).toBeCloseTo(120 - 40 * 0.618, 5);
    expect(levels.find((l) => l.ratio === 0.786)?.price).toBeCloseTo(120 - 40 * 0.786, 5);
    expect(levels.find((l) => l.ratio === 0.786)!.price).toBeLessThan(
      levels.find((l) => l.ratio === 0.618)!.price,
    );
  });

  it('detects an uptrend swing and flags reversal zone on pullback', () => {
    // Unique trough 80, rise to unique peak 120, pullback into ~95.3–88.6 zone.
    const prices = [
      100, 98, 95, 90, 85, 82, 80, // trough
      82, 85, 90, 95, 100, 105, 110, 115, 118, 120, // peak
      115, 110, 105, 100, 95, 92, 90,
    ];
    const analysis = evaluateFibonacciRetracement(prices, { preferDirection: 'uptrend', lookback: 2 });
    expect(analysis).not.toBeNull();
    expect(analysis!.direction).toBe('uptrend');
    expect(analysis!.reversalZone.high).toBeGreaterThan(analysis!.reversalZone.low);
    expect(analysis!.inReversalZone).toBe(true);
    expect(formatFibForAiGrounding('UP', analysis)).toMatch(/uptrend|61\.8%|0\.618/i);
  });
});
