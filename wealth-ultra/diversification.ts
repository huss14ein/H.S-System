import type { WealthUltraPosition, WealthUltraSleeve } from '../types';

export interface DiversificationResult {
  /** Herfindahl-style concentration: sum of (weight)^2. Lower = more diversified. */
  concentrationIndex: number;
  /** Top N tickers as % of portfolio. */
  topNWeights: Array<{ ticker: string; pct: number }>;
  /** By-sleeve concentration (within sleeve). */
  sleeveConcentration: Record<WealthUltraSleeve, number>;
  /** Suggested max single-ticker % from this analysis. */
  suggestedMaxTickerPct: number;
  label: 'well_diversified' | 'moderate' | 'concentrated' | 'highly_concentrated';
}

export function computeDiversification(
  positions: WealthUltraPosition[],
  totalPortfolioValue: number,
  topN = 5
): DiversificationResult {
  if (totalPortfolioValue <= 0 || positions.length === 0) {
    return {
      concentrationIndex: 0,
      topNWeights: [],
      sleeveConcentration: { Core: 0, Upside: 0, Spec: 0 },
      suggestedMaxTickerPct: 20,
      label: 'well_diversified',
    };
  }

  const weights = positions.map((p) => ({
    ticker: p.ticker,
    sleeve: p.sleeveType,
    weight: p.marketValue / totalPortfolioValue,
  }));

  const concentrationIndex = weights.reduce((sum, w) => sum + w.weight * w.weight, 0);
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  const topNWeights = sorted.slice(0, topN).map((w) => ({ ticker: w.ticker, pct: w.weight * 100 }));

  const bySleeve: Record<string, number> = { Core: 0, Upside: 0, Spec: 0 };
  for (const s of ['Core', 'Upside', 'Spec'] as WealthUltraSleeve[]) {
    const sleevePositions = weights.filter((w) => w.sleeve === s);
    const sleeveTotalWeight = sleevePositions.reduce((sum, w) => sum + w.weight, 0);
    if (sleeveTotalWeight > 0) {
      bySleeve[s] = sleevePositions.reduce((sum, w) => sum + (w.weight / sleeveTotalWeight) ** 2, 0);
    }
  }

  const maxTickerPct = sorted[0]?.pct ?? 0;
  let suggestedMaxTickerPct = 20;
  if (maxTickerPct > 30) suggestedMaxTickerPct = 15;
  else if (maxTickerPct > 25) suggestedMaxTickerPct = 18;

  let label: DiversificationResult['label'] = 'well_diversified';
  if (concentrationIndex > 0.25) label = 'highly_concentrated';
  else if (concentrationIndex > 0.15) label = 'concentrated';
  else if (concentrationIndex > 0.08) label = 'moderate';

  return {
    concentrationIndex,
    topNWeights,
    sleeveConcentration: bySleeve as Record<WealthUltraSleeve, number>,
    suggestedMaxTickerPct,
    label,
  };
}
