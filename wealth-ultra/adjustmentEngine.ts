import type { WealthUltraConfig, WealthUltraPosition } from '../types';

export function computePlannedAdjustment(pos: WealthUltraPosition): WealthUltraPosition {
  const addedShares =
    (pos.buy1Qty ?? 0) + (pos.buy2Qty ?? 0) + (pos.buy3Qty ?? 0);
  const addedCost =
    (pos.buy1Qty ?? 0) * (pos.buy1Price ?? 0) +
    (pos.buy2Qty ?? 0) * (pos.buy2Price ?? 0) +
    (pos.buy3Qty ?? 0) * (pos.buy3Price ?? 0);

  const totalShares = pos.currentShares + addedShares;
  const totalCostBasis = pos.currentShares * pos.avgCost + addedCost;
  const newAvgCost = totalShares > 0 ? totalCostBasis / totalShares : pos.avgCost;

  return {
    ...pos,
    plannedAddedShares: addedShares,
    plannedAddedCost: addedCost,
    newTotalShares: totalShares,
    newAvgCost,
  };
}

export function validateAdjustment(
  pos: WealthUltraPosition,
  config: WealthUltraConfig,
  totalPortfolioValue: number,
  deployableCash: number
): { valid: boolean; reason?: string } {
  const addedCost = (pos.plannedAddedCost ?? 0);
  if (addedCost <= 0) return { valid: true };

  const maxTickerValue = totalPortfolioValue * (config.maxPerTickerPct / 100);
  const valueAfter = (pos.marketValue + addedCost);
  if (valueAfter > maxTickerValue) {
    return { valid: false, reason: `Max per ticker ${config.maxPerTickerPct}% exceeded.` };
  }
  if (addedCost > deployableCash) {
    return { valid: false, reason: 'Planned cost exceeds deployable cash.' };
  }
  return { valid: true };
}

export function getTotalPlannedBuyCost(positions: WealthUltraPosition[]): number {
  return positions.reduce((sum, p) => sum + (p.plannedAddedCost ?? 0), 0);
}
