/**
 * Single write path for holdings qty/avgCost after buy/sell.
 * Mutates only the traded symbol via DataContext mutators — never portfolio-wide replay.
 */
import type { Holding } from '../types';
import { roundAvgCostPerUnit } from '../utils/money';
import {
  computePositionFieldsAfterTrade,
  type PositionDeltaSide,
} from './holdingMath';

function isManualFundHolding(holdingType?: Holding['holdingType'] | string | null): boolean {
  return String(holdingType ?? '').trim().toLowerCase() === 'manual_fund';
}

/** Keep unit mark in sync with restated currentValue so qty × currentPrice cannot lag a statement. */
function withManualUnitMark<T extends Pick<Holding, 'quantity' | 'currentValue'> & Partial<Holding>>(
  holding: T,
): T {
  if (!isManualFundHolding(holding.holdingType)) return holding;
  const qty = Number(holding.quantity) || 0;
  const cv = Number(holding.currentValue) || 0;
  if (!(qty > 0) || !Number.isFinite(cv) || cv < 0) return holding;
  return {
    ...holding,
    currentPrice: roundAvgCostPerUnit(cv / qty),
    priceUpdatedAt: new Date().toISOString(),
  };
}

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
  /** Full exit keeps the holdings row at qty 0 so realized P/L can persist. */
  action: 'create' | 'update' | 'close';
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

  const isManualFund =
    isManualFundHolding(args.holdingType) || isManualFundHolding(args.existingHolding?.holdingType);
  const statementRaw = Number(args.manualCurrentValue);
  const statementValue =
    args.manualCurrentValue != null && Number.isFinite(statementRaw) ? statementRaw : undefined;
  // Statement / plan value is a restated TOTAL. Never pass it as currentValueAdd —
  // that would add 500 onto 10k then overwrite currentValue with 500 on persist.
  const computed = computePositionFieldsAfterTrade({
    existing: args.existingHolding,
    side: args.side,
    quantity: qty,
    price: args.price,
    opts:
      args.side === 'buy' && isManualFund && statementValue != null
        ? { currentValueOverride: statementValue }
        : undefined,
  });

  const positionDelta = args.side === 'buy' ? qty : -qty;

  if (computed.action === 'create') {
    await args.addHolding(
      withManualUnitMark({
        symbol,
        name: args.name?.trim() || symbol,
        quantity: computed.quantity,
        avgCost: computed.avgCost,
        currentValue: computed.currentValue,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: args.assetClass ?? 'Stock',
        ...(args.holdingType ? { holdingType: args.holdingType } : {}),
        ...(args.goalId ? { goalId: args.goalId } : {}),
        portfolio_id: args.portfolioId,
      } as Holding & { portfolio_id?: string }),
    );
    return { action: 'create', positionDelta };
  }

  if (computed.action === 'delete') {
    if (!args.existingHolding?.id) throw new Error('Cannot close holding without an id.');
    /** Keep row at qty 0 — syncLotsAfterTrade patches realizedPnL on this row. */
    await args.updateHolding({
      ...args.existingHolding,
      quantity: 0,
      avgCost: computed.avgCost,
      currentValue: 0,
    });
    return { action: 'close', positionDelta };
  }

  if (!args.existingHolding?.id) throw new Error('Cannot update holding without an id.');
  const next: Holding = withManualUnitMark({
    ...args.existingHolding,
    quantity: computed.quantity,
    avgCost: computed.avgCost,
    currentValue: computed.currentValue,
    ...(args.name?.trim() ? { name: args.name.trim() } : {}),
    ...(args.assetClass ? { assetClass: args.assetClass } : {}),
    ...(args.holdingType ? { holdingType: args.holdingType } : {}),
    ...(args.goalId ? { goalId: args.goalId } : {}),
  });
  await args.updateHolding(next);
  return { action: 'update', positionDelta };
}
