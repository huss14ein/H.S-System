import type { WealthUltraConfig, WealthUltraPosition } from '../types';
import { computePlannedAdjustment } from './adjustmentEngine';

export function computeExitPrices(pos: WealthUltraPosition, config: WealthUltraConfig): WealthUltraPosition {
  const adjusted = computePlannedAdjustment(pos);
  const refAvg = adjusted.newAvgCost ?? pos.avgCost;

  const target1Pct = pos.target1PctOverride ?? config.defaultTarget1Pct;
  const target2Pct = pos.target2PctOverride ?? config.defaultTarget2Pct;
  const trailingPct = pos.trailingPctOverride ?? config.defaultTrailingPct;

  const target1Price = pos.applyTarget1 ? refAvg * (1 + target1Pct / 100) : undefined;
  const target2Price = pos.applyTarget2 ? refAvg * (1 + target2Pct / 100) : undefined;
  const trailingStopPrice = pos.applyTrailing ? refAvg * (1 - trailingPct / 100) : undefined;

  return {
    ...adjusted,
    target1Price,
    target2Price,
    trailingStopPrice,
  };
}

export function applyExitEngine(positions: WealthUltraPosition[], config: WealthUltraConfig): WealthUltraPosition[] {
  return positions.map(p => computeExitPrices(p, config));
}
