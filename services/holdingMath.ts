import type { Holding } from '../types';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';

export function applyBuyToHolding(
  holding: Pick<Holding, 'quantity' | 'avgCost' | 'currentValue'>,
  buyQuantity: number,
  buyPrice: number,
  opts?: { /** When set (e.g. manual_fund), adds this to current value instead of cost (qAdd × price). */ currentValueAdd?: number }
): { quantity: number; avgCost: number; currentValue: number } {
  const qOld = Number(holding.quantity) || 0;
  const qAdd = Math.max(0, Number(buyQuantity) || 0);
  const px = roundMoney(Math.max(0, Number(buyPrice) || 0));
  const quantity = roundQuantity(qOld + qAdd);
  const avgCostRaw = quantity > 0 ? (qOld * (Number(holding.avgCost) || 0) + qAdd * px) / quantity : px;
  const addToValue =
    opts?.currentValueAdd != null && Number.isFinite(opts.currentValueAdd)
      ? Math.max(0, Number(opts.currentValueAdd))
      : qAdd * px;
  const currentValueRaw = (Number(holding.currentValue) || 0) + addToValue;
  return {
    quantity,
    avgCost: roundAvgCostPerUnit(avgCostRaw),
    currentValue: roundMoney(currentValueRaw),
  };
}

/**
 * Partial sell keeps WAC (avgCost); scales currentValue with remaining qty.
 * Full sell → closed (qty ~0).
 */
export function applySellToHolding(
  holding: Pick<Holding, 'quantity' | 'avgCost' | 'currentValue'>,
  sellQuantity: number,
): { quantity: number; avgCost: number; currentValue: number; closed: boolean } {
  const prevQty = Math.max(0, Number(holding.quantity) || 0);
  const sellQty = Math.max(0, Number(sellQuantity) || 0);
  const quantity = roundQuantity(Math.max(0, prevQty - sellQty));
  const avgCost = roundAvgCostPerUnit(Number(holding.avgCost) || 0);
  if (quantity < 1e-9) {
    return { quantity: 0, avgCost, currentValue: 0, closed: true };
  }
  const scaledCv =
    prevQty > 1e-9
      ? roundMoney((Number(holding.currentValue) || 0) * (quantity / prevQty))
      : roundMoney(quantity * avgCost);
  return { quantity, avgCost, currentValue: scaledCv, closed: false };
}

export type PositionDeltaSide = 'buy' | 'sell';

export type ComputedPositionDelta = {
  action: 'create' | 'update' | 'delete';
  quantity: number;
  avgCost: number;
  currentValue: number;
};

/** Pure position-book math for one trade — never touches other symbols. */
export function computePositionFieldsAfterTrade(args: {
  existing: Pick<Holding, 'quantity' | 'avgCost' | 'currentValue'> | null | undefined;
  side: PositionDeltaSide;
  quantity: number;
  price: number;
  opts?: { currentValueAdd?: number };
}): ComputedPositionDelta {
  const qty = Math.max(0, Number(args.quantity) || 0);
  const px = Math.max(0, Number(args.price) || 0);
  if (args.side === 'buy') {
    if (!args.existing) {
      const currentValueAdd =
        args.opts?.currentValueAdd != null && Number.isFinite(args.opts.currentValueAdd)
          ? Math.max(0, Number(args.opts.currentValueAdd))
          : qty * px;
      return {
        action: 'create',
        quantity: roundQuantity(qty),
        avgCost: roundAvgCostPerUnit(px),
        currentValue: roundMoney(currentValueAdd),
      };
    }
    const bought = applyBuyToHolding(args.existing, qty, px, args.opts);
    return { action: 'update', ...bought };
  }
  if (!args.existing) {
    throw new Error('Cannot sell a holding you do not own.');
  }
  const sold = applySellToHolding(args.existing, qty);
  if (sold.closed) {
    return { action: 'delete', quantity: 0, avgCost: sold.avgCost, currentValue: 0 };
  }
  return {
    action: 'update',
    quantity: sold.quantity,
    avgCost: sold.avgCost,
    currentValue: sold.currentValue,
  };
}

/**
 * Weighted merge of same-symbol rows. Do NOT use for trade prep or auto-heal —
 * summing ghosts (e.g. LCID 500+1390) recreates historical books. Use
 * resolveDuplicateHoldingsGroup from holdingsDedupe instead.
 */
export function consolidateHoldingsBySymbol(holdings: Holding[]): Holding | null {
  if (!holdings.length) return null;
  const primary = holdings[0];
  const totalQuantity = holdings.reduce((s, h) => s + Math.max(0, Number(h.quantity) || 0), 0);
  const totalCost = holdings.reduce((s, h) => s + Math.max(0, Number(h.quantity) || 0) * (Number(h.avgCost) || 0), 0);
  const avgCostRaw = totalQuantity > 0 ? totalCost / totalQuantity : Number(primary.avgCost) || 0;
  const currentValue = roundMoney(holdings.reduce((s, h) => s + (Number(h.currentValue) || 0), 0));
  const realizedPnL = roundMoney(holdings.reduce((s, h) => s + (Number(h.realizedPnL) || 0), 0));

  return {
    ...primary,
    quantity: roundQuantity(totalQuantity),
    avgCost: roundAvgCostPerUnit(avgCostRaw),
    currentValue,
    realizedPnL,
  };
}
