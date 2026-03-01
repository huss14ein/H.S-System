import type { WealthUltraConfig, WealthUltraPosition } from '../types';
import { getRiskWeight } from './config';

/** Capital efficiency = return % × risk weight. Higher score = better risk-adjusted return. */
export function capitalEfficiencyScore(plPct: number, riskTier: string, config: WealthUltraConfig): number {
  const pct = typeof plPct === 'number' && Number.isFinite(plPct) ? plPct : 0;
  const tier = riskTier && String(riskTier) || 'Med';
  const weight = getRiskWeight(config, tier);
  return pct * weight;
}

export function rankByCapitalEfficiency(positions: WealthUltraPosition[], config: WealthUltraConfig): WealthUltraPosition[] {
  return [...positions].sort((a, b) => {
    const scoreA = capitalEfficiencyScore(a.plPct, a.riskTier ?? 'Med', config);
    const scoreB = capitalEfficiencyScore(b.plPct, b.riskTier ?? 'Med', config);
    const sa = Number.isFinite(scoreA) ? scoreA : -Infinity;
    const sb = Number.isFinite(scoreB) ? scoreB : -Infinity;
    return sb - sa;
  });
}
