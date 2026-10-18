/**
 * Fibonacci retracement analysis for downtrend / uptrend swings.
 * Levels match common TA practice (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1).
 * Downtrend interest zone: 0.618–0.786 (golden ratio → deep retracement).
 */

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export type FibRatio = (typeof FIB_RATIOS)[number];

export type SwingPoint = { index: number; price: number };

export type FibDirection = 'downtrend' | 'uptrend';

export type FibLevel = {
  ratio: FibRatio;
  price: number;
  label: string;
};

export type FibAnalysis = {
  direction: FibDirection;
  swingHigh: SwingPoint;
  swingLow: SwingPoint;
  levels: FibLevel[];
  /** Price band between 0.618 and 0.786 (order depends on direction). */
  reversalZone: { low: number; high: number };
  currentPrice: number;
  /** True when last price sits inside the 0.618–0.786 interest zone. */
  inReversalZone: boolean;
  /** Downtrend: price broke above 0.786. Uptrend: price broke below 0.786. */
  scenarioInvalidated: boolean;
  /** Educational signal for UI / alerts. */
  signal:
    | 'watch_reversal_zone'
    | 'in_reversal_zone'
    | 'scenario_invalidated'
    | 'awaiting_retracement'
    | null;
  summary: string;
};

function ratioLabel(ratio: FibRatio): string {
  if (ratio === 0.618) return '61.8% (golden)';
  if (ratio === 0.786) return '78.6%';
  if (ratio === 0.5) return '50%';
  if (ratio === 0.382) return '38.2%';
  if (ratio === 0.236) return '23.6%';
  if (ratio === 0) return '0%';
  return '100%';
}

/** Local swing highs/lows using a symmetric lookback window. */
export function findSwingPoints(prices: number[], lookback = 3): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  if (!Array.isArray(prices) || prices.length < lookback * 2 + 1) {
    return { highs, lows };
  }
  for (let i = lookback; i < prices.length - lookback; i++) {
    const p = prices[i];
    if (!Number.isFinite(p)) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const q = prices[j];
      if (!Number.isFinite(q)) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (q >= p) isHigh = false;
      if (q <= p) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: p });
    if (isLow) lows.push({ index: i, price: p });
  }
  return { highs, lows };
}

/**
 * Latest significant downtrend swing: swing high followed by a later swing low
 * with a material drop (≥ minDropPct of the high).
 */
export function detectLatestDowntrendSwing(
  prices: number[],
  opts?: { lookback?: number; minDropPct?: number },
): { high: SwingPoint; low: SwingPoint } | null {
  const lookback = opts?.lookback ?? 3;
  const minDropPct = opts?.minDropPct ?? 0.03;
  const { highs, lows } = findSwingPoints(prices, lookback);
  if (highs.length === 0 || lows.length === 0) return null;

  for (let hi = highs.length - 1; hi >= 0; hi--) {
    const high = highs[hi];
    const laterLows = lows.filter((l) => l.index > high.index && l.price < high.price);
    if (laterLows.length === 0) continue;
    const low = laterLows.reduce((best, l) => (l.price < best.price ? l : best));
    const drop = (high.price - low.price) / high.price;
    if (drop >= minDropPct) return { high, low };
  }
  return null;
}

/**
 * Latest significant uptrend swing: swing low followed by a later swing high.
 */
export function detectLatestUptrendSwing(
  prices: number[],
  opts?: { lookback?: number; minRisePct?: number },
): { high: SwingPoint; low: SwingPoint } | null {
  const lookback = opts?.lookback ?? 3;
  const minRisePct = opts?.minRisePct ?? 0.03;
  const { highs, lows } = findSwingPoints(prices, lookback);
  if (highs.length === 0 || lows.length === 0) return null;

  for (let li = lows.length - 1; li >= 0; li--) {
    const low = lows[li];
    const laterHighs = highs.filter((h) => h.index > low.index && h.price > low.price);
    if (laterHighs.length === 0) continue;
    const high = laterHighs.reduce((best, h) => (h.price > best.price ? h : best));
    const rise = (high.price - low.price) / low.price;
    if (rise >= minRisePct) return { high, low };
  }
  return null;
}

/** Downtrend: Level = High − (High − Low) × ratio. Uptrend: Level = Low + (High − Low) × ratio. */
export function computeFibonacciLevels(
  high: number,
  low: number,
  direction: FibDirection,
): FibLevel[] {
  const span = high - low;
  if (!(Number.isFinite(high) && Number.isFinite(low) && span > 0)) return [];
  return FIB_RATIOS.map((ratio) => {
    const price = direction === 'downtrend' ? high - span * ratio : low + span * ratio;
    return { ratio, price, label: ratioLabel(ratio) };
  });
}

function levelPrice(levels: FibLevel[], ratio: FibRatio): number | null {
  const hit = levels.find((l) => l.ratio === ratio);
  return hit && Number.isFinite(hit.price) ? hit.price : null;
}

export function evaluateFibonacciRetracement(
  prices: number[],
  opts?: { currentPrice?: number; preferDirection?: FibDirection | 'auto'; lookback?: number },
): FibAnalysis | null {
  const series = (prices ?? []).filter((p): p is number => Number.isFinite(p));
  if (series.length < 15) return null;

  const currentPrice =
    opts?.currentPrice != null && Number.isFinite(opts.currentPrice)
      ? Number(opts.currentPrice)
      : series[series.length - 1];

  const prefer = opts?.preferDirection ?? 'auto';
  const down = prefer === 'uptrend' ? null : detectLatestDowntrendSwing(series, { lookback: opts?.lookback });
  const up = prefer === 'downtrend' ? null : detectLatestUptrendSwing(series, { lookback: opts?.lookback });

  let direction: FibDirection;
  let high: SwingPoint;
  let low: SwingPoint;

  if (prefer === 'downtrend' && down) {
    direction = 'downtrend';
    high = down.high;
    low = down.low;
  } else if (prefer === 'uptrend' && up) {
    direction = 'uptrend';
    high = up.high;
    low = up.low;
  } else if (down && up) {
    // Prefer the swing that completed more recently.
    if (down.low.index >= up.high.index) {
      direction = 'downtrend';
      high = down.high;
      low = down.low;
    } else {
      direction = 'uptrend';
      high = up.high;
      low = up.low;
    }
  } else if (down) {
    direction = 'downtrend';
    high = down.high;
    low = down.low;
  } else if (up) {
    direction = 'uptrend';
    high = up.high;
    low = up.low;
  } else {
    return null;
  }

  const levels = computeFibonacciLevels(high.price, low.price, direction);
  const r618 = levelPrice(levels, 0.618);
  const r786 = levelPrice(levels, 0.786);
  if (r618 == null || r786 == null) return null;

  const zoneLow = Math.min(r618, r786);
  const zoneHigh = Math.max(r618, r786);
  const inReversalZone = currentPrice >= zoneLow && currentPrice <= zoneHigh;
  const scenarioInvalidated =
    direction === 'downtrend' ? currentPrice > zoneHigh : currentPrice < zoneLow;

  let signal: FibAnalysis['signal'] = 'awaiting_retracement';
  if (scenarioInvalidated) signal = 'scenario_invalidated';
  else if (inReversalZone) signal = 'in_reversal_zone';
  else if (direction === 'downtrend' && currentPrice > low.price && currentPrice < zoneLow) {
    signal = 'watch_reversal_zone';
  } else if (direction === 'uptrend' && currentPrice < high.price && currentPrice > zoneHigh) {
    signal = 'watch_reversal_zone';
  }

  const summary =
    direction === 'downtrend'
      ? inReversalZone
        ? `Price in 61.8–78.6% reversal zone after downswing — watch for selling pressure / trend resume.`
        : scenarioInvalidated
          ? `Price above 78.6% — bearish Fib scenario weakened/invalidated.`
          : `Downtrend Fib drawn high→low; monitor 61.8% (golden) and 78.6% zone.`
      : inReversalZone
        ? `Price in 61.8–78.6% reversal zone after upswing — watch for buying pressure / trend resume.`
        : scenarioInvalidated
          ? `Price below 78.6% — bullish Fib scenario weakened/invalidated.`
          : `Uptrend Fib drawn low→high; monitor 61.8% (golden) and 78.6% zone.`;

  return {
    direction,
    swingHigh: high,
    swingLow: low,
    levels,
    reversalZone: { low: zoneLow, high: zoneHigh },
    currentPrice,
    inReversalZone,
    scenarioInvalidated,
    signal,
    summary,
  };
}

/** Compact signal line for Watchlist / holdings Signals column. */
export function formatFibSignalShort(analysis: FibAnalysis | null | undefined): string | null {
  if (!analysis) return null;
  const zone = `${analysis.reversalZone.low.toFixed(2)}–${analysis.reversalZone.high.toFixed(2)}`;
  if (analysis.signal === 'in_reversal_zone') return `Fib zone ${zone}`;
  if (analysis.signal === 'scenario_invalidated') return `Fib invalid (>78.6%)`;
  if (analysis.signal === 'watch_reversal_zone') return `Fib watch → ${zone}`;
  return `Fib ${analysis.direction === 'downtrend' ? '↓' : '↑'} ${zone}`;
}

/** Prompt snippet so AI grounds Fibonacci bullets in computed levels. */
export function formatFibForAiGrounding(symbol: string, analysis: FibAnalysis | null | undefined): string {
  if (!analysis) return `${symbol}: insufficient history for Fib swings.`;
  const lvl = analysis.levels
    .filter((l) => l.ratio === 0.382 || l.ratio === 0.5 || l.ratio === 0.618 || l.ratio === 0.786)
    .map((l) => `${l.label}=${l.price.toFixed(4)}`)
    .join(', ');
  return `${symbol}: ${analysis.direction} swing high=${analysis.swingHigh.price.toFixed(4)} (i=${analysis.swingHigh.index}) → low=${analysis.swingLow.price.toFixed(4)} (i=${analysis.swingLow.index}); levels: ${lvl}; zone=${analysis.reversalZone.low.toFixed(4)}–${analysis.reversalZone.high.toFixed(4)}; last=${analysis.currentPrice.toFixed(4)}; signal=${analysis.signal ?? 'none'}. ${analysis.summary}`;
}

/** Session-stable key so zone-entry toasts fire at most once per symbol per calendar day. */
export function fibZoneAlertDedupeKey(symbol: string, ymd: string): string {
  return `finova-fib-zone:${String(symbol || '').trim().toUpperCase()}:${ymd}`;
}

export function shouldNotifyFibZoneEntry(
  analysis: FibAnalysis | null | undefined,
  symbol: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): boolean {
  if (!analysis || analysis.signal !== 'in_reversal_zone') return false;
  const sym = String(symbol || '').trim();
  if (!sym) return false;
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  if (!store) return true;
  const ymd = new Date().toISOString().slice(0, 10);
  const key = fibZoneAlertDedupeKey(sym, ymd);
  try {
    if (store.getItem(key)) return false;
    store.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}
