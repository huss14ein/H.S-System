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
