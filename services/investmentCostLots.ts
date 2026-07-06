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
};

export type LotSellAllocation = {
  lotId: string;
  quantity: number;
  costPerShare: number;
  realizedPnL: number;
};

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
}): CostLot {
  return {
    id: args.id,
    symbol: args.symbol.toUpperCase(),
    acquisitionDate: args.acquisitionDate.slice(0, 10),
    quantityRemaining: Math.max(0, args.quantity),
    costPerShare: Math.max(0, args.costPerShare),
    bookCurrency: args.bookCurrency ?? 'SAR',
  };
}
