import type { WealthUltraConfig, WealthUltraPosition } from '../types';
import { getRiskWeight } from './config';

/**
 * Compute a 0–100 risk score per position (higher = riskier).
 * Sleeve-aware: Spec and concentration contribute more to score.
 */
export function positionRiskScore(
  pos: WealthUltraPosition,
  totalPortfolioValue: number,
  config: WealthUltraConfig
): number {
  if (totalPortfolioValue <= 0) return 0;
  const weight = getRiskWeight(config, pos.riskTier ?? 'Med');
  const concentrationPct = (pos.marketValue / totalPortfolioValue) * 100;
  let score = 0;
  if (pos.sleeveType === 'Spec') score += 35;
  else if (pos.sleeveType === 'Upside') score += 15;
  if (concentrationPct > 15) score += Math.min(30, (concentrationPct - 15));
  if (pos.plPct <= -20) score += 25;
  else if (pos.plPct <= -10) score += 15;
  score += Math.min(20, weight * 8);
  return Math.min(100, Math.round(score));
}

/**
 * Attach riskScore to each position (mutates in place for compatibility).
 */
export function attachRiskScores(
  positions: WealthUltraPosition[],
  totalPortfolioValue: number,
  config: WealthUltraConfig
): WealthUltraPosition[] {
  return positions.map((p) => ({
    ...p,
    riskScore: positionRiskScore(p, totalPortfolioValue, config),
  }));
}
