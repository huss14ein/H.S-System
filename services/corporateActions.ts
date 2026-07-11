/**
 * Corporate actions — splits, reverse splits, cash-in-lieu, spinoffs, mergers (KSA/US/Tadawul).
 * Cost basis and realized P/L in SAR — not tax reporting.
 */

export type CorporateActionType =
  | 'stock_split'
  | 'reverse_stock_split'
  | 'cash_dividend'
  | 'stock_dividend'
  | 'cash_in_lieu'
  | 'spinoff'
  | 'merger'
  | 'dividend_drip';

export interface CorporateAction {
  type: CorporateActionType;
  ratioNumerator?: number;
  ratioDenominator?: number;
  dividendPerShare?: number;
  cashInLieuPrice?: number;
  costBasisAllocationPct?: number;
  linkedSymbol?: string;
  conversionRatio?: number;
  cashPerShare?: number;
}

export interface HoldingLike {
  quantity: number;
  avgCost: number;
}

export function splitRatio(action: CorporateAction): number {
  const num = Math.max(1e-9, Number(action.ratioNumerator) || 1);
  const den = Math.max(1e-9, Number(action.ratioDenominator) || 1);
  return num / den;
}

export function splitProducesFraction(quantity: number, action: CorporateAction): boolean {
  const ratio = splitRatio(action);
  const newQty = quantity * ratio;
  return newQty - Math.floor(newQty) > 1e-9;
}

/** Reverse split floors fractional shares when cash-in-lieu price is provided. */
export function reverseSplitFloorsFraction(action: CorporateAction, quantity: number): boolean {
  if (action.type !== 'reverse_stock_split') return false;
  if (!splitProducesFraction(quantity, action)) return false;
  return (Number(action.cashInLieuPrice) || 0) > 0;
}

export function shouldFloorSplitQuantity(action: CorporateAction, quantity: number): boolean {
  if (action.type === 'cash_in_lieu') return true;
  return reverseSplitFloorsFraction(action, quantity);
}

export function recalculateCostBasisAfterAction(args: {
  action: CorporateAction;
  holding: HoldingLike;
}): { quantity: number; avgCost: number } {
  const q = Math.max(0, Number(args.holding.quantity) || 0);
  const avgCost = Math.max(0, Number(args.holding.avgCost) || 0);
  const action = args.action;

  if (action.type === 'stock_split' || action.type === 'stock_dividend') {
    const ratio = splitRatio(action);
    const newQuantity = q * ratio;
    const newAvgCost = ratio > 0 ? avgCost / ratio : avgCost;
    return { quantity: newQuantity, avgCost: newAvgCost };
  }

  if (action.type === 'reverse_stock_split') {
    const ratio = splitRatio(action);
    const newQtyRaw = q * ratio;
    const newQuantity = shouldFloorSplitQuantity(action, q) ? Math.floor(newQtyRaw) : newQtyRaw;
    const newAvgCost = ratio > 0 ? avgCost / ratio : avgCost;
    return { quantity: newQuantity, avgCost: newAvgCost };
  }

  if (action.type === 'cash_dividend' || action.type === 'dividend_drip') {
    return { quantity: q, avgCost };
  }

  if (action.type === 'cash_in_lieu') {
    const ratio = splitRatio(action);
    const newQty = q * ratio;
    const whole = Math.floor(newQty);
    return { quantity: whole, avgCost: ratio > 0 ? avgCost / ratio : avgCost };
  }

  if (action.type === 'spinoff') {
    const pct = Math.min(1, Math.max(0, Number(action.costBasisAllocationPct) || 0));
    return { quantity: q, avgCost: avgCost * (1 - pct) };
  }

  if (action.type === 'merger') {
    return { quantity: 0, avgCost: 0 };
  }

  return { quantity: q, avgCost };
}

export function applyCorporateAction(args: {
  action: CorporateAction;
  holding: HoldingLike;
}): {
  quantity: number;
  avgCost: number;
  cashReceived?: number;
  cashInLieu?: number;
  spinoffGrant?: { symbol: string; quantity: number; avgCost: number };
  mergerGrant?: { symbol: string; quantity: number; avgCost: number };
} {
  const base = recalculateCostBasisAfterAction(args);
  const action = args.action;
  const q = Math.max(0, Number(args.holding.quantity) || 0);
  const avgCost = Math.max(0, Number(args.holding.avgCost) || 0);

  if (action.type === 'cash_dividend') {
    return {
      ...base,
      cashReceived: q * (Number(action.dividendPerShare) || 0),
    };
  }

  if (action.type === 'cash_in_lieu') {
    const ratio = splitRatio(action);
    const newQty = q * ratio;
    const whole = Math.floor(newQty);
    const fraction = newQty - whole;
    const price = Math.max(0, Number(action.cashInLieuPrice) || 0);
    return { ...base, quantity: whole, cashInLieu: fraction * price };
  }

  if (action.type === 'reverse_stock_split' && shouldFloorSplitQuantity(action, q)) {
    const ratio = splitRatio(action);
    const newQtyRaw = q * ratio;
    const whole = Math.floor(newQtyRaw);
    const fraction = newQtyRaw - whole;
    const price = Math.max(0, Number(action.cashInLieuPrice) || 0);
    return {
      quantity: whole,
      avgCost: ratio > 0 ? avgCost / ratio : avgCost,
      cashInLieu: fraction * price,
    };
  }

  if (action.type === 'spinoff' && action.linkedSymbol) {
    const pct = Math.min(1, Math.max(0, Number(action.costBasisAllocationPct) || 0));
    const ratio = splitRatio(action);
    const childQty = q * ratio;
    const childCost = avgCost * pct;
    return {
      ...base,
      spinoffGrant: {
        symbol: action.linkedSymbol,
        quantity: childQty,
        avgCost: childQty > 0 ? childCost / childQty : 0,
      },
    };
  }

  if (action.type === 'merger' && action.linkedSymbol) {
    const conv = Math.max(0, Number(action.conversionRatio) || 1);
    const cash = Math.max(0, Number(action.cashPerShare) || 0);
    const grantQty = q * conv;
    return {
      quantity: 0,
      avgCost: 0,
      cashReceived: q * cash,
      mergerGrant: {
        symbol: action.linkedSymbol,
        quantity: grantQty,
        avgCost: grantQty > 0 ? (q * avgCost) / grantQty : 0,
      },
    };
  }

  return base;
}

export function buildCorporateActionIdempotencyKey(parts: Record<string, string | number | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v != null && String(v).length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

export function inverseCorporateAction(action: CorporateAction): CorporateAction {
  if (action.type === 'stock_split') {
    return { ...action, type: 'reverse_stock_split', ratioNumerator: action.ratioDenominator, ratioDenominator: action.ratioNumerator };
  }
  if (action.type === 'reverse_stock_split') {
    return { ...action, type: 'stock_split', ratioNumerator: action.ratioDenominator, ratioDenominator: action.ratioNumerator };
  }
  return action;
}

export function detectDelistedAssetRisk(args: {
  status: 'active' | 'delisted' | 'unknown';
  monthsSinceFlagged?: number;
}): { riskLabel: 'low' | 'med' | 'high'; isRisky: boolean } {
  const months = Number.isFinite(args.monthsSinceFlagged) ? (args.monthsSinceFlagged as number) : 0;
  if (args.status === 'delisted') return { riskLabel: 'high', isRisky: true };
  if (args.status === 'unknown') return { riskLabel: months <= 3 ? 'med' : 'low', isRisky: months <= 3 };
  return { riskLabel: 'low', isRisky: false };
}
