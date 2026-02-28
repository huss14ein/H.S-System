import type { WealthUltraConfig, WealthUltraPosition, WealthUltraSleeveAllocation } from '../types';
import { getTotalPortfolioValue, isDriftAlert } from './allocationEngine';
import { computeDeployableCash } from './cashPlanner';

export interface MonthlyDeploymentResult {
  amountToDeploy: number;
  suggestedTicker: string | null;
  reason: string;
}

export function runMonthlyCoreDeployment(
  config: WealthUltraConfig,
  positions: WealthUltraPosition[],
  allocations: WealthUltraSleeveAllocation[]
): MonthlyDeploymentResult {
  const deployableCash = computeDeployableCash(config);
  const totalValue = getTotalPortfolioValue(positions);
  const coreAlloc = allocations.find(a => a.sleeve === 'Core');
  if (!coreAlloc) {
    return { amountToDeploy: 0, suggestedTicker: null, reason: 'No Core allocation.' };
  }

  const amountToDeploy = Math.min(config.monthlyDeposit, deployableCash);
  if (amountToDeploy <= 0) {
    return { amountToDeploy: 0, suggestedTicker: null, reason: 'No deployable cash.' };
  }

  if (isDriftAlert(coreAlloc.driftPct)) {
    return {
      amountToDeploy,
      suggestedTicker: null,
      reason: `Core drift ${coreAlloc.driftPct.toFixed(1)}% — review allocation before deploying.`,
    };
  }

  const corePositions = positions
    .filter(p => p.sleeveType === 'Core')
    .sort((a, b) => a.plPct - b.plPct);
  const mostUnderperforming = corePositions[0];
  const maxTickerValue = totalValue * (config.maxPerTickerPct / 100);
  const candidate = corePositions.find(p => p.marketValue < maxTickerValue);

  return {
    amountToDeploy,
    suggestedTicker: candidate?.ticker ?? mostUnderperforming?.ticker ?? null,
    reason: candidate ? 'Allocate to most underperforming Core ticker within limits.' : 'Max per ticker may cap deployment.',
  };
}
