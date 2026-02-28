import type {
  WealthUltraConfig,
  WealthUltraPosition,
  WealthUltraSleeveAllocation,
  WealthUltraAlert,
} from '../types';
import { getTotalPortfolioValue } from './allocationEngine';
import { isDriftAlert } from './allocationEngine';
import { isSpecBreach } from './specRisk';
import { runCashPlanner } from './cashPlanner';

const TRIM_THRESHOLD_PCT = 40;
const RISK_REVIEW_THRESHOLD_PCT = -30;

export function runAlertEngine(
  config: WealthUltraConfig,
  positions: WealthUltraPosition[],
  allocations: WealthUltraSleeveAllocation[]
): WealthUltraAlert[] {
  const alerts: WealthUltraAlert[] = [];
  const totalValue = getTotalPortfolioValue(positions);
  const cashResult = runCashPlanner(config, positions);

  for (const alloc of allocations) {
    if (isDriftAlert(alloc.driftPct)) {
      alerts.push({
        type: 'sleeve_overweight',
        message: `${alloc.sleeve} sleeve drift ${alloc.driftPct > 0 ? '+' : ''}${alloc.driftPct.toFixed(1)}% from target.`,
        sleeve: alloc.sleeve,
        value: alloc.driftPct,
      });
    }
  }

  const specAlloc = allocations.find(a => a.sleeve === 'Spec');
  if (isSpecBreach(config, specAlloc)) {
    alerts.push({
      type: 'spec_breach',
      message: `Spec allocation (${specAlloc?.allocationPct.toFixed(1)}%) exceeds target + 2%. New Spec buys disabled.`,
      sleeve: 'Spec',
    });
  }

  for (const pos of positions) {
    if (totalValue <= 0) continue;
    const tickerPct = (pos.marketValue / totalValue) * 100;
    if (tickerPct > config.maxPerTickerPct) {
      alerts.push({
        type: 'max_per_ticker_breach',
        message: `${pos.ticker} at ${tickerPct.toFixed(1)}% exceeds max ${config.maxPerTickerPct}%.`,
        ticker: pos.ticker,
        value: tickerPct,
      });
    }
    if (pos.plPct >= TRIM_THRESHOLD_PCT) {
      alerts.push({
        type: 'position_trim_suggest',
        message: `${pos.ticker} +${pos.plPct.toFixed(0)}% — consider trim.`,
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
    if (pos.plPct <= RISK_REVIEW_THRESHOLD_PCT) {
      alerts.push({
        type: 'position_risk_review',
        message: `${pos.ticker} ${pos.plPct.toFixed(0)}% — risk review.`,
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
  }

  if (cashResult.status === 'OVER_BUDGET') {
    alerts.push({
      type: 'over_budget',
      message: `Planned buys (${cashResult.totalPlannedBuyCost.toFixed(0)}) exceed deployable cash (${cashResult.deployableCash.toFixed(0)}).`,
    });
  }

  return alerts;
}
