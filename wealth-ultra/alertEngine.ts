import type {
  WealthUltraConfig,
  WealthUltraPosition,
  WealthUltraSleeveAllocation,
  WealthUltraAlert,
  WealthUltraAlertSeverity,
} from '../types';
import { getTotalPortfolioValue, isDriftAlert, DRIFT_ALERT_PCT } from './allocationEngine';
import { isSpecBreach } from './specRisk';
import { runCashPlanner, computeDeployableCash } from './cashPlanner';
import type { MonthlyDeploymentResult } from './monthlyDeployment';
import { rankByCapitalEfficiency } from './capitalEfficiency';

const TRIM_THRESHOLD_PCT = 40;
const RISK_REVIEW_THRESHOLD_PCT = -30;
const DIP_BUY_RANGE_PCT = -15;
const SPEC_LOSS_REVIEW_PCT = -20;
const TRAILING_NEAR_PCT = 5;
const CONCENTRATION_TOP_N = 3;
const CONCENTRATION_WARN_PCT = 50;
const UNDERPERFORMER_TOP_N = 3;
const PORTFOLIO_STRESS_LOSS_PCT = -10;
const PORTFOLIO_STRESS_MIN_POSITIONS = 3;
const PORTFOLIO_STRESS_RATIO = 0.4; // 40%+ of positions in loss
const CASH_DEPLOY_MIN_RATIO = 0.02; // deployable >= 2% of portfolio to suggest

export function runAlertEngine(
  config: WealthUltraConfig,
  positions: WealthUltraPosition[],
  allocations: WealthUltraSleeveAllocation[],
  monthlyDeployment?: MonthlyDeploymentResult | null
): WealthUltraAlert[] {
  const alerts: WealthUltraAlert[] = [];
  const totalValue = getTotalPortfolioValue(positions);
  const cashResult = runCashPlanner(config, positions);
  const deployableCash = computeDeployableCash(config);
  const reserveAmount = totalValue * (config.cashReservePct / 100);

  const driftThreshold = config.driftAlertPct ?? DRIFT_ALERT_PCT;
  // ---- Sleeve allocation drift (over or under target) ----
  // No deployable portfolio value: drift is not meaningful (engine reports 0% drift).
  if (totalValue > 0) {
    for (const alloc of allocations) {
      if (!isDriftAlert(alloc.driftPct, driftThreshold)) continue;
      const over = alloc.driftPct > 0;
      const sleeve = alloc.sleeve;
      const type = over ? 'sleeve_overweight' : 'sleeve_drift';
      const severity: WealthUltraAlertSeverity = Math.abs(alloc.driftPct) > 10 ? 'warning' : 'info';
      alerts.push({
        type,
        title: over ? 'Rebalance' : 'Allocation gap',
        severity,
        message: over
          ? `${sleeve} is ${alloc.driftPct.toFixed(1)}% over target (current ${alloc.allocationPct.toFixed(1)}% vs target ${alloc.targetPct}%).`
          : `${sleeve} is ${Math.abs(alloc.driftPct).toFixed(1)}% under target (current ${alloc.allocationPct.toFixed(1)}% vs target ${alloc.targetPct}%).`,
        actionHint: over
          ? `Trim ${sleeve} winners or pause new ${sleeve} buys until allocation is back near ${alloc.targetPct}%.`
          : sleeve === 'Core'
            ? `Use Monthly Core deployment to add to Core, or add to ${sleeve} to close the gap.`
            : `Add to ${sleeve} when you deploy (within risk limits).`,
        sleeve: alloc.sleeve,
        value: alloc.driftPct,
      });
    }
  }

  // ---- Spec breach ----
  const specAlloc = allocations.find(a => a.sleeve === 'Spec');
  if (specAlloc && isSpecBreach(config, specAlloc)) {
    alerts.push({
      type: 'spec_breach',
      title: 'Spec limit',
      severity: 'warning',
      message: `Spec is ${specAlloc.allocationPct.toFixed(1)}% (target ${config.targetSpecPct}%). New Spec buys are disabled until back in range.`,
      actionHint: 'Trim Spec winners or add to Core/Upside to rebalance. No new Spec buys until allocation is under target.',
      sleeve: 'Spec',
      value: specAlloc.allocationPct,
    });
  }

  // ---- Max per ticker breach ----
  for (const pos of positions) {
    if (totalValue <= 0) continue;
    const tickerPct = (pos.marketValue / totalValue) * 100;
    if (tickerPct > config.maxPerTickerPct) {
      alerts.push({
        type: 'max_per_ticker_breach',
        title: 'Concentration',
        severity: 'warning',
        message: `${pos.ticker} is ${tickerPct.toFixed(1)}% of portfolio (max ${config.maxPerTickerPct}%).`,
        actionHint: `Trim ${pos.ticker} or add to other positions so no single ticker exceeds ${config.maxPerTickerPct}%.`,
        ticker: pos.ticker,
        value: tickerPct,
      });
    }
  }

  // ---- Trim suggestion (large unrealized gain) — grouped when 3+ ----
  const trimCandidates = positions.filter(p => p.plPct >= TRIM_THRESHOLD_PCT);
  if (trimCandidates.length >= 3) {
    const tickers = trimCandidates.map(p => p.ticker);
    const worst = trimCandidates.sort((a, b) => b.plPct - a.plPct)[0];
    alerts.push({
      type: 'position_trim_suggest',
      title: 'Take profits',
      severity: 'info',
      message: `${trimCandidates.length} positions are up 40%+ (${tickers.join(', ')}). Top: ${worst.ticker} +${worst.plPct.toFixed(0)}%.`,
      actionHint: 'Consider trimming winners and rebalancing into Core to lock in gains and reduce concentration.',
      tickers,
      value: trimCandidates.length,
    });
  } else {
    for (const pos of trimCandidates) {
      alerts.push({
        type: 'position_trim_suggest',
        title: 'Take profits',
        severity: 'info',
        message: `${pos.ticker} is up ${pos.plPct.toFixed(0)}% (${pos.sleeveType}).`,
        actionHint: 'Consider partial profits or rebalancing into Core to lock in gains.',
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
  }

  // ---- Risk review (large unrealized loss) ----
  for (const pos of positions) {
    if (pos.plPct <= RISK_REVIEW_THRESHOLD_PCT) {
      alerts.push({
        type: 'position_risk_review',
        title: 'Risk review',
        severity: 'critical',
        message: `${pos.ticker} is down ${pos.plPct.toFixed(0)}% (${pos.sleeveType}).`,
        actionHint: 'Review your notes. Exit if conviction is gone; average down only if you remain confident and within risk limits.',
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
  }

  // ---- Dip-buy opportunity (Core/Upside in DipBuy mode) — grouped when 3+ ----
  const dipBuyCandidates = positions.filter(
    p => p.strategyMode === 'DipBuy' && p.plPct <= DIP_BUY_RANGE_PCT && p.plPct > RISK_REVIEW_THRESHOLD_PCT
  );
  if (dipBuyCandidates.length >= 3) {
    const tickers = dipBuyCandidates.map(p => p.ticker);
    alerts.push({
      type: 'dip_buy_opportunity',
      title: 'Dip-buy zone',
      severity: 'info',
      message: `${dipBuyCandidates.length} positions in DipBuy range (down 15–30%): ${tickers.join(', ')}.`,
      actionHint: 'If your reasons still hold for these names, consider adding within allocation limits. Prefer Core/Upside over Spec.',
      tickers,
      value: dipBuyCandidates.length,
    });
  } else {
    for (const pos of dipBuyCandidates) {
      alerts.push({
        type: 'dip_buy_opportunity',
        title: 'Dip-buy zone',
        severity: 'info',
        message: `${pos.ticker} (${pos.sleeveType}) is down ${pos.plPct.toFixed(0)}% — in DipBuy range.`,
        actionHint: 'If your reasons still hold, consider adding within your allocation limits.',
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
  }

  // ---- Spec loss review ----
  for (const pos of positions) {
    if (pos.sleeveType === 'Spec' && pos.plPct <= SPEC_LOSS_REVIEW_PCT) {
      alerts.push({
        type: 'spec_loss_review',
        title: 'Spec loss',
        severity: 'warning',
        message: `Spec position ${pos.ticker} is down ${pos.plPct.toFixed(0)}%.`,
        actionHint: 'Spec is higher risk. Decide: hold, trim, or exit based on your risk tolerance and notes.',
        ticker: pos.ticker,
        value: pos.plPct,
      });
    }
  }

  // ---- Trailing stop near ----
  for (const pos of positions) {
    const trail = pos.trailingStopPrice;
    if (trail != null && trail > 0 && pos.currentPrice > 0) {
      const pctAboveStop = ((pos.currentPrice - trail) / trail) * 100;
      if (pctAboveStop >= 0 && pctAboveStop <= TRAILING_NEAR_PCT) {
        alerts.push({
          type: 'trailing_stop_near',
          title: 'Trailing stop',
          severity: 'info',
          message: `${pos.ticker} is within ${pctAboveStop.toFixed(1)}% of trailing stop (${trail.toFixed(2)}).`,
          actionHint: 'If price falls to the stop, consider exiting or tightening the stop.',
          ticker: pos.ticker,
          value: pctAboveStop,
        });
      }
    }
  }

  // ---- Concentration risk (top N tickers) ----
  if (positions.length >= CONCENTRATION_TOP_N && totalValue > 0) {
    const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
    const topValue = sorted.slice(0, CONCENTRATION_TOP_N).reduce((s, p) => s + p.marketValue, 0);
    const topPct = (topValue / totalValue) * 100;
    if (topPct >= CONCENTRATION_WARN_PCT) {
      const names = sorted.slice(0, CONCENTRATION_TOP_N).map(p => p.ticker).join(', ');
      alerts.push({
        type: 'concentration_risk',
        title: 'Concentration',
        severity: 'warning',
        message: `Top ${CONCENTRATION_TOP_N} positions (${names}) are ${topPct.toFixed(0)}% of portfolio.`,
        actionHint: 'Diversify: add to other sleeves or names to reduce concentration risk.',
        tickers: sorted.slice(0, CONCENTRATION_TOP_N).map(p => p.ticker),
        value: topPct,
      });
    }
  }

  // ---- Cash reserve low ----
  if (totalValue > 0 && deployableCash < reserveAmount && reserveAmount > 0) {
    alerts.push({
      type: 'cash_reserve_low',
      title: 'Cash reserve',
      severity: 'warning',
      message: `Deployable cash (${deployableCash.toFixed(0)}) is below reserve target (${reserveAmount.toFixed(0)} = ${config.cashReservePct}% of portfolio).`,
      actionHint: 'Pause new buys until cash builds, or reduce planned buys to stay within reserve.',
      value: deployableCash,
    });
  }

  // ---- Over budget (planned buys > deployable) ----
  if (cashResult.status === 'OVER_BUDGET') {
    alerts.push({
      type: 'over_budget',
      title: 'Over budget',
      severity: 'critical',
      message: `Planned buys (${cashResult.totalPlannedBuyCost.toFixed(0)}) exceed deployable cash (${cashResult.deployableCash.toFixed(0)}).`,
      actionHint: 'Reduce planned orders or add cash so total planned cost does not exceed deployable.',
      value: cashResult.totalPlannedBuyCost,
    });
  }

  // ---- Deployment opportunity (monthly Core) ----
  if (monthlyDeployment && monthlyDeployment.amountToDeploy > 0 && monthlyDeployment.suggestedTicker) {
    alerts.push({
      type: 'deployment_opportunity',
      title: 'Deploy to Core',
      severity: 'info',
      message: `You can deploy up to ${monthlyDeployment.amountToDeploy.toFixed(0)} to Core. Suggested: ${monthlyDeployment.suggestedTicker}.`,
      actionHint: monthlyDeployment.reason,
      ticker: monthlyDeployment.suggestedTicker,
      value: monthlyDeployment.amountToDeploy,
    });
  }

  // ---- Underperformer review (worst capital efficiency) ----
  if (positions.length >= 2) {
    const ranked = rankByCapitalEfficiency(positions, config);
    const toReview = ranked.slice(-Math.min(UNDERPERFORMER_TOP_N, ranked.length));
    if (toReview.length >= 1) {
      const pctStr = toReview.map(p => `${p.ticker} ${p.plPct >= 0 ? '+' : ''}${p.plPct.toFixed(0)}%`).join(', ');
      alerts.push({
        type: 'underperformer_review',
        title: 'Review underperformers',
        severity: 'info',
        message: `Weakest risk-adjusted returns (return % × risk weight): ${pctStr}.`,
        actionHint: 'Review these positions: trim or exit if your reasons have changed; add only with high conviction.',
        tickers: toReview.map(p => p.ticker),
        value: toReview.length,
      });
    }
  }

  // ---- Cash deploy prompt (deployable cash + Core under target) ----
  const coreAlloc = allocations.find(a => a.sleeve === 'Core');
  if (
    totalValue > 0 &&
    coreAlloc &&
    coreAlloc.driftPct < -driftThreshold &&
    deployableCash >= totalValue * CASH_DEPLOY_MIN_RATIO &&
    !alerts.some(a => a.type === 'deployment_opportunity' && a.ticker)
  ) {
    const gapPct = Math.abs(coreAlloc.driftPct).toFixed(1);
    alerts.push({
      type: 'cash_deploy_prompt',
      title: 'Deploy to Core',
      severity: 'info',
      message: `You have ${deployableCash.toFixed(0)} deployable; Core is ${gapPct}% under target (${coreAlloc.allocationPct.toFixed(1)}% vs ${coreAlloc.targetPct}%).`,
      actionHint: 'Use Monthly Core deployment or add to Core positions to close the gap.',
      value: deployableCash,
    });
  }

  // ---- Portfolio stress (many positions in meaningful loss) ----
  if (positions.length >= PORTFOLIO_STRESS_MIN_POSITIONS) {
    const inLoss = positions.filter(p => p.plPct <= PORTFOLIO_STRESS_LOSS_PCT);
    const ratio = inLoss.length / positions.length;
    if (ratio >= PORTFOLIO_STRESS_RATIO) {
      alerts.push({
        type: 'portfolio_stress',
        title: 'Portfolio stress',
        severity: 'warning',
        message: `${inLoss.length} of ${positions.length} positions are down more than ${Math.abs(PORTFOLIO_STRESS_LOSS_PCT)}%.`,
        actionHint: 'Review overall portfolio and risk. Consider reducing exposure or rebalancing into Core if stress is high.',
        tickers: inLoss.map(p => p.ticker),
        value: inLoss.length,
      });
    }
  }

  // ---- Portfolio on track (positive reinforcement when no critical/warning) ----
  const hasCritical = alerts.some(a => a.severity === 'critical');
  const hasWarning = alerts.some(a => a.severity === 'warning');
  const allocsHealthy = allocations.every(a => !isDriftAlert(a.driftPct, driftThreshold));
  if (!hasCritical && !hasWarning && allocations.length > 0 && allocsHealthy && positions.length > 0) {
    alerts.push({
      type: 'portfolio_on_track',
      title: 'On track',
      severity: 'info',
      message: 'Allocation is within target; no critical or warning issues. Use opportunities above to refine.',
      actionHint: 'Keep deploying to plan; trim winners or add to dip-buy names as appropriate.',
    });
  }

  // Sort: critical first, then warning, then info; then by absolute value where relevant
  const severityOrder: Record<WealthUltraAlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  alerts.sort((a, b) => {
    const sa = (a.severity && severityOrder[a.severity]) ?? 2;
    const sb = (b.severity && severityOrder[b.severity]) ?? 2;
    if (sa !== sb) return sa - sb;
    return 0;
  });

  return alerts;
}
