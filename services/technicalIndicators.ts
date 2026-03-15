/**
 * Technical Analysis & Intelligence ("The Eyes")
 * - Mean reversion (Z-Score)
 * - RSI (Relative Strength Index)
 * - Bollinger Bands
 * - SMA / EMA and crossovers (Golden Cross / Death Cross)
 */

/** Price series: newest last (index 0 = oldest). */
export type PriceSeries = number[];

export function sma(prices: PriceSeries, period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    out.push(sum / period);
  }
  return out;
}

export function ema(prices: PriceSeries, period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = prices[0];
  out.push(prev);
  for (let i = 1; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Crossover: returns 1 when fast crosses above slow, -1 when below, 0 otherwise (at index i). */
export function crossover(fast: number[], slow: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < fast.length; i++) {
    const f0 = fast[i - 1];
    const f1 = fast[i];
    const s0 = slow[i - 1];
    const s1 = slow[i];
    if (f0 <= s0 && f1 > s1) out.push(1);
    else if (f0 >= s0 && f1 < s1) out.push(-1);
    else out.push(0);
  }
  out.unshift(0);
  return out;
}

/** Golden Cross: SMA(50) crosses above SMA(200). Death Cross: opposite. */
export function smaCrossoverSignal(prices: PriceSeries): { golden: boolean; death: boolean; lastSignal: number } {
  const fast = sma(prices, 50);
  const slow = sma(prices, 200);
  const cross = crossover(fast, slow);
  const last = cross[cross.length - 1] ?? 0;
  return {
    golden: last === 1,
    death: last === -1,
    lastSignal: last,
  };
}

/** Short-term crossover for limited data: SMA(fastPeriod) vs SMA(slowPeriod). Use when < 200 points (e.g. 5 vs 10). */
export function shortTermCrossoverSignal(
  prices: PriceSeries,
  fastPeriod: number = 5,
  slowPeriod: number = 10
): { golden: boolean; death: boolean } | null {
  if (prices.length < slowPeriod) return null;
  const fast = sma(prices, fastPeriod);
  const slow = sma(prices, slowPeriod);
  const cross = crossover(fast, slow);
  const last = cross[cross.length - 1] ?? 0;
  return { golden: last === 1, death: last === -1 };
}

/**
 * RSI: Overbought (70+), Oversold (30-).
 */
export function rsi(prices: PriceSeries, period: number = 14): number[] {
  const out: number[] = Array(period).fill(NaN);
  for (let i = period; i < prices.length; i++) {
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j < i; j++) {
      const ch = (prices[j + 1] ?? 0) - (prices[j] ?? 0);
      if (ch > 0) gains += ch;
      else losses -= ch;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) {
      out.push(100);
      continue;
    }
    const rs = avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

export function rsiSignal(rsiValue: number): 'overbought' | 'oversold' | 'neutral' {
  if (rsiValue >= 70) return 'overbought';
  if (rsiValue <= 30) return 'oversold';
  return 'neutral';
}

/**
 * Bollinger Bands: middle = SMA(20), upper/lower = middle ± k * std(20).
 */
export function bollingerBands(prices: PriceSeries, period: number = 20, k: number = 2): { middle: number[]; upper: number[]; lower: number[] } {
  const middle = sma(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    let sumSq = 0;
    const m = middle[i] ?? 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = (prices[j] ?? 0) - m;
      sumSq += d * d;
    }
    const std = Math.sqrt(sumSq / period);
    upper.push(m + k * std);
    lower.push(m - k * std);
  }
  return { middle, upper, lower };
}

/** Z-Score (mean reversion): (price - mean) / std. |z| > 2 suggests over-extended. */
export function zScore(prices: PriceSeries, period: number = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance) || 1e-10;
    out.push(((prices[i] ?? 0) - mean) / std);
  }
  return out;
}

export function zScoreSignal(z: number): 'over_extended_high' | 'over_extended_low' | 'neutral' {
  if (z >= 2) return 'over_extended_high';
  if (z <= -2) return 'over_extended_low';
  return 'neutral';
}
