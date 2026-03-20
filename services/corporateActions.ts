/**
 * Corporate actions logic (logic layer).
 *
 * Supports split/reverse split and simple cash dividends adjustment.
 * This is an intentionally simple model; a full implementation would need
 * exchange-specific details and event histories.
 */

export type CorporateActionType =
  | 'stock_split'
  | 'reverse_stock_split'
  | 'cash_dividend'
  | 'stock_dividend';

export interface CorporateAction {
  type: CorporateActionType;
  /** Ratio fields: split 1:K means shares * K. */
  ratioNumerator?: number;
  ratioDenominator?: number;
  /** Cash dividend per share (for cash_dividend). */
  dividendPerShare?: number;
}

export interface HoldingLike {
  quantity: number;
  avgCost: number; // average cost per share
}

export function recalculateCostBasisAfterAction(args: {
  action: CorporateAction;
  holding: HoldingLike;
}): { quantity: number; avgCost: number } {
  const q = Math.max(0, Number(args.holding.quantity) || 0);
  const avgCost = Math.max(0, Number(args.holding.avgCost) || 0);
  const action = args.action;

  if (action.type === 'stock_split' || action.type === 'reverse_stock_split') {
    const num = Math.max(1e-9, Number(action.ratioNumerator) || 1);
    const den = Math.max(1e-9, Number(action.ratioDenominator) || 1);
    // If den grows, shares reduce => reverse split.
    const ratio = num / den;
    const newQuantity = q * ratio;
    const newAvgCost = ratio > 0 ? avgCost / ratio : avgCost;
    return { quantity: newQuantity, avgCost: newAvgCost };
  }

  if (action.type === 'cash_dividend') {
    // Simple: quantity unchanged, cost basis unchanged.
    return { quantity: q, avgCost };
  }

  if (action.type === 'stock_dividend') {
    const num = Math.max(1e-9, Number(action.ratioNumerator) || 1);
    const den = Math.max(1e-9, Number(action.ratioDenominator) || 1);
    const ratio = num / den;
    const newQuantity = q * ratio;
    const newAvgCost = ratio > 0 ? avgCost / ratio : avgCost;
    return { quantity: newQuantity, avgCost: newAvgCost };
  }

  return { quantity: q, avgCost };
}

export function applyCorporateAction(args: {
  action: CorporateAction;
  holding: HoldingLike;
}): { quantity: number; avgCost: number; cashReceived?: number } {
  const base = recalculateCostBasisAfterAction(args);
  const action = args.action;
  const cashReceived =
    action.type === 'cash_dividend'
      ? Math.max(0, args.holding.quantity) * (Number(action.dividendPerShare) || 0)
      : undefined;
  return { ...base, cashReceived };
}

export function detectDelistedAssetRisk(args: {
  status: 'active' | 'delisted' | 'unknown';
  /** Optional: how long ago it was flagged. */
  monthsSinceFlagged?: number;
}): { riskLabel: 'low' | 'med' | 'high'; isRisky: boolean } {
  const months = Number.isFinite(args.monthsSinceFlagged) ? (args.monthsSinceFlagged as number) : 0;
  if (args.status === 'delisted') return { riskLabel: 'high', isRisky: true };
  if (args.status === 'unknown') return { riskLabel: months <= 3 ? 'med' : 'low', isRisky: months <= 3 };
  return { riskLabel: 'low', isRisky: false };
}

