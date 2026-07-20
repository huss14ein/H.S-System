/**
 * FIFO cost lots for realized P/L (KSA product — not tax reporting).
 */
export type CostLot = {
  id: string;
  symbol: string;
  acquisitionDate: string;
  quantityRemaining: number;
  costPerShare: number;
  bookCurrency: 'SAR' | 'USD';
  /** Original buy transaction id when known (must be UUID for DB). */
  sourceTransactionId?: string | null;
};

export type LotSellAllocation = {
  lotId: string;
  quantity: number;
  costPerShare: number;
  realizedPnL: number;
};

/** UUID for cost-lot primary keys (Postgres `investment_cost_lots.id`). */
export function newCostLotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Deterministic-enough fallback for non-browser test hosts without Web Crypto.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Allocate a sell quantity across lots FIFO (oldest acquisition first). */
export function allocateFifoSell(
  lots: CostLot[],
  symbol: string,
  sellQty: number,
  sellPrice: number,
): { allocations: LotSellAllocation[]; remainingLots: CostLot[] } {
  const sym = symbol.toUpperCase();
  const ordered = [...lots]
    .filter((l) => l.symbol.toUpperCase() === sym && l.quantityRemaining > 1e-9)
    .sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate) || a.id.localeCompare(b.id));

  let remaining = Math.max(0, sellQty);
  const allocations: LotSellAllocation[] = [];
  const remainingLots: CostLot[] = [];

  for (const lot of ordered) {
    if (remaining <= 1e-9) {
      remainingLots.push(lot);
      continue;
    }
    const take = Math.min(lot.quantityRemaining, remaining);
    allocations.push({
      lotId: lot.id,
      quantity: take,
      costPerShare: lot.costPerShare,
      realizedPnL: (sellPrice - lot.costPerShare) * take,
    });
    const left = lot.quantityRemaining - take;
    if (left > 1e-9) remainingLots.push({ ...lot, quantityRemaining: left });
    remaining -= take;
  }

  for (const lot of lots) {
    if (lot.symbol.toUpperCase() !== sym) remainingLots.push(lot);
  }

  return { allocations, remainingLots };
}

/** Open a new lot from a buy. */
export function openCostLotFromBuy(args: {
  id: string;
  symbol: string;
  acquisitionDate: string;
  quantity: number;
  costPerShare: number;
  bookCurrency?: 'SAR' | 'USD';
  sourceTransactionId?: string | null;
}): CostLot {
  return {
    id: args.id,
    symbol: args.symbol.toUpperCase(),
    acquisitionDate: args.acquisitionDate.slice(0, 10),
    quantityRemaining: Math.max(0, args.quantity),
    costPerShare: Math.max(0, args.costPerShare),
    bookCurrency: args.bookCurrency ?? 'SAR',
    sourceTransactionId: args.sourceTransactionId ?? null,
  };
}
