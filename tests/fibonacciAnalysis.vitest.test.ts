import { describe, expect, it } from 'vitest';
import {
  computeFibonacciLevels,
  detectLatestDowntrendSwing,
  evaluateFibonacciRetracement,
  formatFibForAiGrounding,
  formatFibSignalShort,
  shouldNotifyFibZoneEntry,
} from '../services/fibonacciAnalysis';

/** Synthetic downtrend then retrace into 0.618–0.786 zone. */
function buildDowntrendThenRetrace(): number[] {
  const prices: number[] = [];
  // Quiet preamble
  for (let i = 0; i < 8; i++) prices.push(100);
  // Peak plateau
  for (let i = 0; i < 5; i++) prices.push(120);
  // Drop to trough
  for (let i = 0; i < 8; i++) prices.push(120 - i * 5); // ends ~80
  // Flat at low
  for (let i = 0; i < 4; i++) prices.push(80);
  // Retrace toward 61.8–78.6 of (120→80) span=40 → zone ≈ 104.72–111.44
  prices.push(90, 98, 105, 108);
  return prices;
}

describe('fibonacciAnalysis', () => {
  it('computes downtrend levels High − (High−Low)×ratio', () => {
    const levels = computeFibonacciLevels(120, 80, 'downtrend');
    expect(levels.find((l) => l.ratio === 0)?.price).toBeCloseTo(120, 5);
    expect(levels.find((l) => l.ratio === 1)?.price).toBeCloseTo(80, 5);
    expect(levels.find((l) => l.ratio === 0.618)?.price).toBeCloseTo(120 - 40 * 0.618, 5);
    expect(levels.find((l) => l.ratio === 0.786)?.price).toBeCloseTo(120 - 40 * 0.786, 5);
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
    expect(formatFibForAiGrounding('TEST', analysis)).toContain('0.618');
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
});
