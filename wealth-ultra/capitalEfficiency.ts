import type { WealthUltraConfig, WealthUltraPosition } from '../types';
import { getRiskWeight } from './config';

export function capitalEfficiencyScore(plPct: number, riskTier: string, config: WealthUltraConfig): number {
  const weight = getRiskWeight(config, riskTier);
  return plPct * weight;
}

export function rankByCapitalEfficiency(positions: WealthUltraPosition[], config: WealthUltraConfig): WealthUltraPosition[] {
  return [...positions].sort((a, b) => {
    const scoreA = capitalEfficiencyScore(a.plPct, a.riskTier, config);
    const scoreB = capitalEfficiencyScore(b.plPct, b.riskTier, config);
    return scoreB - scoreA;
  });
}
