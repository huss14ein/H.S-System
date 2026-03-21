import type { WealthUltraConfig, WealthUltraPosition, WealthUltraSleeve, WealthUltraSleeveAllocation } from '../types';

const DRIFT_ALERT_THRESHOLD_PCT = 5;

export function computeSleeveAllocations(
  positions: WealthUltraPosition[],
  config: WealthUltraConfig,
  totalPortfolioValue: number
): WealthUltraSleeveAllocation[] {
  const sleeves: WealthUltraSleeve[] = ['Core', 'Upside', 'Spec'];
  const targetBySleeve: Record<WealthUltraSleeve, number> = {
    Core: config.targetCorePct,
    Upside: config.targetUpsidePct,
    Spec: config.targetSpecPct,
  };

  return sleeves.map(sleeve => {
    const marketValue = positions
      .filter(p => p.sleeveType === sleeve)
      .reduce((sum, p) => sum + p.marketValue, 0);
    const allocationPct = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;
    const targetPct = targetBySleeve[sleeve];
    const driftPct = allocationPct - targetPct;

    return {
      sleeve,
      marketValue,
      allocationPct,
      targetPct,
      driftPct,
    };
  });
}

export function getTotalPortfolioValue(positions: WealthUltraPosition[]): number {
  return positions.reduce((sum, p) => sum + p.marketValue, 0);
}

export function isDriftAlert(driftPct: number, thresholdPct?: number): boolean {
  const t = Number.isFinite(thresholdPct) && thresholdPct != null ? thresholdPct : DRIFT_ALERT_THRESHOLD_PCT;
  return Math.abs(driftPct) > t;
}

export const DRIFT_ALERT_PCT = DRIFT_ALERT_THRESHOLD_PCT;
