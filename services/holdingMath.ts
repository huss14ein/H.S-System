import type { Holding } from '../types';

export function applyBuyToHolding(
  holding: Pick<Holding, 'quantity' | 'avgCost' | 'currentValue'>,
  buyQuantity: number,
  buyPrice: number
): { quantity: number; avgCost: number; currentValue: number } {
  const qOld = Number(holding.quantity) || 0;
  const qAdd = Math.max(0, Number(buyQuantity) || 0);
  const px = Math.max(0, Number(buyPrice) || 0);
  const quantity = qOld + qAdd;
  const avgCost = quantity > 0 ? (qOld * (Number(holding.avgCost) || 0) + qAdd * px) / quantity : px;
  const currentValue = (Number(holding.currentValue) || 0) + qAdd * px;
  return { quantity, avgCost, currentValue };
}

export function consolidateHoldingsBySymbol(holdings: Holding[]): Holding | null {
  if (!holdings.length) return null;
  const primary = holdings[0];
  const totalQuantity = holdings.reduce((s, h) => s + Math.max(0, Number(h.quantity) || 0), 0);
  const totalCost = holdings.reduce((s, h) => s + Math.max(0, Number(h.quantity) || 0) * (Number(h.avgCost) || 0), 0);
  const avgCost = totalQuantity > 0 ? totalCost / totalQuantity : Number(primary.avgCost) || 0;
  const currentValue = holdings.reduce((s, h) => s + (Number(h.currentValue) || 0), 0);
  const realizedPnL = holdings.reduce((s, h) => s + (Number(h.realizedPnL) || 0), 0);

  return {
    ...primary,
    quantity: totalQuantity,
    avgCost,
    currentValue,
    realizedPnL,
  };
}
