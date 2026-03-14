import type { WealthUltraPosition, WealthUltraOrder } from '../types';

function scoreBuyOrder(pos: WealthUltraPosition): { score: number; rationale: string } {
  const hasPlan = (pos.plannedAddedShares ?? 0) > 0;
  if (!hasPlan) return { score: 0, rationale: '' };
  const driftHelp = pos.sleeveType === 'Core' ? 1 : pos.sleeveType === 'Upside' ? 0.8 : 0.5;
  const riskHeadroom = pos.riskTier === 'Low' ? 1 : pos.riskTier === 'Med' ? 0.8 : pos.riskTier === 'High' ? 0.5 : 0.3;
  const efficiencyBoost = typeof pos.plPct === 'number' && !Number.isNaN(pos.plPct)
    ? pos.plPct < 0
      ? Math.min(1, Math.abs(pos.plPct) / 30) // stronger when buying dips
      : 0.3
    : 0.5;
  const sizeFactor = Math.min(1, ((pos.plannedAddedCost ?? 0) || (pos.plannedAddedShares ?? 0) * (pos.buy1Price ?? pos.currentPrice)) / Math.max(1, pos.marketValue || 1));
  const score = 100 * (0.4 * driftHelp + 0.3 * riskHeadroom + 0.2 * efficiencyBoost + 0.1 * sizeFactor);
  const rationaleParts: string[] = [];
  if (pos.sleeveType === 'Core') rationaleParts.push('adds to Core sleeve');
  if (pos.plPct < 0) rationaleParts.push('averaging into a dip');
  if (pos.riskTier === 'Low' || pos.riskTier === 'Med') rationaleParts.push('within risk guardrails');
  const rationale = rationaleParts.length ? rationaleParts.join('; ') : 'supports allocation and risk policy';
  return { score, rationale };
}

function scoreSellOrder(pos: WealthUltraPosition): { score: number; rationale: string } {
  if (pos.currentShares <= 0 || (!pos.applyTarget1 && !pos.applyTarget2 && !pos.applyTrailing)) {
    return { score: 0, rationale: '' };
  }
  const profitFactor = pos.plPct > 0 ? Math.min(1, pos.plPct / 40) : 0;
  const riskFactor =
    pos.riskTier === 'Spec' ? 1 :
    pos.riskTier === 'High' ? 0.8 :
    pos.riskTier === 'Med' ? 0.5 : 0.3;
  const trailingProtection = pos.applyTrailing ? 0.8 : 0.4;
  const score = 100 * (0.4 * profitFactor + 0.4 * riskFactor + 0.2 * trailingProtection);
  const rationaleParts: string[] = [];
  if (pos.plPct >= 0) rationaleParts.push('locks in gains');
  if (pos.riskTier === 'High' || pos.riskTier === 'Spec') rationaleParts.push('reduces high-risk exposure');
  if (pos.applyTrailing) rationaleParts.push('protects downside with trailing stop');
  const rationale = rationaleParts.length ? rationaleParts.join('; ') : 'manages risk and crystallizes P&L';
  return { score, rationale };
}

export function generateOrders(positions: WealthUltraPosition[]): WealthUltraOrder[] {
  const buyOrders: WealthUltraOrder[] = [];
  const sellOrders: WealthUltraOrder[] = [];

  for (const pos of positions) {
    const plannedShares = pos.plannedAddedShares ?? 0;
    if (plannedShares > 0 && pos.buy1Price != null) {
      const { score, rationale } = scoreBuyOrder(pos);
      buyOrders.push({
        type: 'BUY',
        ticker: pos.ticker,
        qty: plannedShares,
        limitPrice: pos.buy1Price,
        orderType: 'LIMIT',
        tif: 'GTC',
        priorityScore: Math.round(score),
        rationale,
      });
    }

    if (pos.currentShares > 0 && (pos.applyTarget1 || pos.applyTarget2 || pos.applyTrailing)) {
      const { score, rationale } = scoreSellOrder(pos);
      sellOrders.push({
        type: 'SELL',
        ticker: pos.ticker,
        qty: pos.currentShares,
        orderType: 'LIMIT',
        tif: 'GTC',
        target1Price: pos.applyTarget1 ? pos.target1Price : undefined,
        target2Price: pos.applyTarget2 ? pos.target2Price : undefined,
        trailingStopPrice: pos.applyTrailing ? pos.trailingStopPrice : undefined,
        priorityScore: Math.round(score),
        rationale,
      });
    }
  }

  // Sort BUYs and SELLs separately by priority so UI can display most impactful first.
  buyOrders.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  sellOrders.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  return [...buyOrders, ...sellOrders];
}

export function exportOrdersJson(orders: WealthUltraOrder[]): string {
  return JSON.stringify(orders, null, 2);
}
