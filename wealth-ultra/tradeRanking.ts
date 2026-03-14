import type { WealthUltraConfig, WealthUltraPosition } from '../types';

/**
 * Sleeve-aware trade ranking: assign execution priority (1 = highest) for buys and sells.
 * Buys: prefer Core under target, then dip-buy candidates, then remaining.
 * Sells: prefer trim candidates (high gain), then exit/risk-review.
 */
export function rankTrades(
  positions: WealthUltraPosition[],
  _config: WealthUltraConfig,
  sleeveDrift: Record<string, number>
): WealthUltraPosition[] {
  const rankMap = new Map<string, number>();
  const buyCandidates = positions.filter((p) => (p.plannedAddedShares ?? 0) > 0);
  const sellCandidates = positions.filter((p) => p.currentShares > 0 && (p.applyTarget1 || p.applyTarget2 || p.applyTrailing));

  let r = 1;
  for (const pos of buyCandidates) {
    const drift = sleeveDrift[pos.sleeveType] ?? 0;
    if (pos.sleeveType === 'Core' && drift < -5) {
      rankMap.set(pos.ticker, r++);
    }
  }
  for (const pos of buyCandidates) {
    if (rankMap.has(pos.ticker)) continue;
    if (pos.strategyMode === 'DipBuy') rankMap.set(pos.ticker, r++);
  }
  for (const pos of buyCandidates) {
    if (rankMap.has(pos.ticker)) continue;
    rankMap.set(pos.ticker, r++);
  }
  const sellRankStart = r;
  const byGain = [...sellCandidates].sort((a, b) => (b.plPct ?? 0) - (a.plPct ?? 0));
  byGain.forEach((pos, i) => rankMap.set(pos.ticker, sellRankStart + i));

  return positions.map((p) => ({
    ...p,
    tradeRank: rankMap.get(p.ticker) ?? 999,
  }));
}

/**
 * Get positions sorted by trade rank (best execution order).
 */
export function positionsByTradeRank(positions: WealthUltraPosition[]): WealthUltraPosition[] {
  return [...positions].sort((a, b) => (a.tradeRank ?? 999) - (b.tradeRank ?? 999));
}
