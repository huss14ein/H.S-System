import type { WealthUltraConfig } from '../types';
import { getTotalPlannedBuyCost } from './adjustmentEngine';
import type { WealthUltraPosition } from '../types';

export type CashPlannerResult = {
  deployableCash: number;
  totalPlannedBuyCost: number;
  status: 'WITHIN_LIMIT' | 'OVER_BUDGET';
};

export function computeDeployableCash(config: WealthUltraConfig): number {
  return config.cashAvailable * (1 - config.cashReservePct / 100);
}

export function runCashPlanner(
  config: WealthUltraConfig,
  positions: WealthUltraPosition[]
): CashPlannerResult {
  const deployableCash = computeDeployableCash(config);
  const totalPlannedBuyCost = getTotalPlannedBuyCost(positions);
  const status = totalPlannedBuyCost <= deployableCash ? 'WITHIN_LIMIT' : 'OVER_BUDGET';
  return { deployableCash, totalPlannedBuyCost, status };
}
