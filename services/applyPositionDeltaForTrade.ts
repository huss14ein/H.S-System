/**
 * Single write path for holdings qty/avgCost after buy/sell.
 * Mutates only the traded symbol via DataContext mutators — never portfolio-wide replay.
 */
import type { Holding } from '../types';
import {
  computePositionFieldsAfterTrade,
  type PositionDeltaSide,
} from './holdingMath';

export type ApplyPositionDeltaForTradeArgs = {
  portfolioId: string;
  symbol: string;
  side: PositionDeltaSide;
  quantity: number;
  price: number;
  /** Consolidated primary row for this symbol (may be missing on first buy). */
  existingHolding?: Holding | null;
  /** Extra duplicate rows for the same symbol — deleted after consolidate/apply. */
  duplicateHoldingIds?: string[];
  name?: string;
  assetClass?: Holding['assetClass'];
  holdingType?: Holding['holdingType'];
  manualCurrentValue?: number;
  goalId?: string;
  updateHolding: (h: Holding) => Promise<void>;
  addHolding: (h: Holding & { portfolio_id?: string }) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
};

export type ApplyPositionDeltaForTradeResult = {
  action: 'create' | 'update' | 'delete';
  positionDelta: number;
};

export async function applyPositionDeltaForTrade(
  args: ApplyPositionDeltaForTradeArgs,
): Promise<ApplyPositionDeltaForTradeResult> {
  const symbol = String(args.symbol ?? '').trim().toUpperCase();
  if (!symbol) throw new Error('Symbol is required.');
  const qty = Math.max(0, Number(args.quantity) || 0);
  if (!(qty > 0)) throw new Error('Trade quantity must be greater than zero.');

  for (const dupId of args.duplicateHoldingIds ?? []) {
    if (dupId && dupId !== args.existingHolding?.id) {
      await args.deleteHolding(dupId);
    }
  }

  const computed = computePositionFieldsAfterTrade({
    existing: args.existingHolding,
    side: args.side,
    quantity: qty,
    price: args.price,
    opts:
      args.side === 'buy' && args.manualCurrentValue != null && Number.isFinite(args.manualCurrentValue)
        ? { currentValueAdd: args.manualCurrentValue }
        : undefined,
  });

  const positionDelta = args.side === 'buy' ? qty : -qty;

  if (computed.action === 'create') {
    await args.addHolding({
      symbol,
      name: args.name?.trim() || symbol,
      quantity: computed.quantity,
      avgCost: computed.avgCost,
      currentValue:
        args.manualCurrentValue != null && Number.isFinite(args.manualCurrentValue)
          ? args.manualCurrentValue
          : computed.currentValue,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
      assetClass: args.assetClass ?? 'Stock',
      ...(args.holdingType ? { holdingType: args.holdingType } : {}),
      ...(args.goalId ? { goalId: args.goalId } : {}),
      portfolio_id: args.portfolioId,
    } as Holding & { portfolio_id?: string });
    return { action: 'create', positionDelta };
  }

  if (computed.action === 'delete') {
    if (!args.existingHolding?.id) throw new Error('Cannot close holding without an id.');
    await args.deleteHolding(args.existingHolding.id);
    return { action: 'delete', positionDelta };
  }

  if (!args.existingHolding?.id) throw new Error('Cannot update holding without an id.');
  const next: Holding = {
    ...args.existingHolding,
    quantity: computed.quantity,
    avgCost: computed.avgCost,
    currentValue:
      args.side === 'buy' && args.manualCurrentValue != null && Number.isFinite(args.manualCurrentValue)
        ? args.manualCurrentValue
        : computed.currentValue,
    ...(args.name?.trim() ? { name: args.name.trim() } : {}),
    ...(args.assetClass ? { assetClass: args.assetClass } : {}),
    ...(args.holdingType ? { holdingType: args.holdingType } : {}),
    ...(args.goalId ? { goalId: args.goalId } : {}),
  };
  await args.updateHolding(next);
  return { action: 'update', positionDelta };
}
