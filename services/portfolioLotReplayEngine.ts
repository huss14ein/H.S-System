/**
 * FIFO cost lot replay — chronological rebuild from trades + corporate actions.
 * KSA product: realized P/L in SAR/USD book currency, not tax reporting.
 */
import type { CorporateAction } from './corporateActions';
import { splitRatio, shouldFloorSplitQuantity } from './corporateActions';
import { allocateFifoSell, openCostLotFromBuy, type CostLot } from './investmentCostLots';
import { costLotToInvestmentCostLot } from './investmentCostLotDb';
import type { CorporateActionReplayEvent } from './portfolioReplayEngine';
import { sortInvestmentTransactionsChronological } from './portfolioReplayEngine';
import type { InvestmentCostLot, InvestmentTransaction } from '../types';
import { yieldToMain } from '../utils/yieldToMain';

export type LotReplayResult = {
  lots: InvestmentCostLot[];
  realizedPnLBySymbol: Map<string, number>;
  realizedPnLByTransactionId: Map<string, number>;
};

const CHUNK_SIZE = 100;

function applyCorporateActionToCostLots(
  lots: CostLot[],
  symbol: string,
  action: CorporateAction,
  linkedSymbol?: string,
): CostLot[] {
  const sym = symbol.toUpperCase();
  const symLots = lots.filter((l) => l.symbol.toUpperCase() === sym);
  const other = lots.filter((l) => l.symbol.toUpperCase() !== sym);

  if (action.type === 'stock_split' || action.type === 'stock_dividend') {
    const ratio = splitRatio(action);
    const updated = symLots.map((l) => ({
      ...l,
      quantityRemaining: l.quantityRemaining * ratio,
      costPerShare: ratio > 0 ? l.costPerShare / ratio : l.costPerShare,
    }));
    return [...other, ...updated];
  }

  if (action.type === 'reverse_stock_split') {
    const ratio = splitRatio(action);
    const totalQty = symLots.reduce((s, l) => s + l.quantityRemaining, 0);
    if (shouldFloorSplitQuantity(action, totalQty)) {
      const updated = symLots.map((l) => {
        const newQty = l.quantityRemaining * ratio;
        const whole = Math.floor(newQty);
        return {
          ...l,
          quantityRemaining: whole,
          costPerShare: ratio > 0 ? l.costPerShare / ratio : l.costPerShare,
        };
      });
      return [...other, ...updated.filter((l) => l.quantityRemaining > 1e-9)];
    }
    const updated = symLots.map((l) => ({
      ...l,
      quantityRemaining: l.quantityRemaining * ratio,
      costPerShare: ratio > 0 ? l.costPerShare / ratio : l.costPerShare,
    }));
    return [...other, ...updated];
  }

  if (action.type === 'cash_in_lieu') {
    const ratio = splitRatio(action);
    const updated = symLots.map((l) => {
      const newQty = l.quantityRemaining * ratio;
      const whole = Math.floor(newQty);
      return {
        ...l,
        quantityRemaining: whole,
        costPerShare: ratio > 0 ? l.costPerShare / ratio : l.costPerShare,
      };
    });
    return [...other, ...updated.filter((l) => l.quantityRemaining > 1e-9)];
  }

  if (action.type === 'spinoff' && linkedSymbol) {
    const pct = Math.min(1, Math.max(0, Number(action.costBasisAllocationPct) || 0));
    const ratio = splitRatio(action);
    const childSym = linkedSymbol.toUpperCase();
    const childLots: CostLot[] = [];
    const parentUpdated: CostLot[] = [];
    for (const lot of symLots) {
      const childQty = lot.quantityRemaining * ratio;
      const childCostTotal = lot.quantityRemaining * lot.costPerShare * pct;
      const parentCostPerShare = lot.costPerShare * (1 - pct);
      parentUpdated.push({ ...lot, costPerShare: parentCostPerShare });
      if (childQty > 1e-9) {
        childLots.push({
          id: `ca-spin-${lot.id}-${childSym}`,
          symbol: childSym,
          acquisitionDate: lot.acquisitionDate,
          quantityRemaining: childQty,
          costPerShare: childQty > 0 ? childCostTotal / childQty : 0,
          bookCurrency: lot.bookCurrency,
        });
      }
    }
    return [...other, ...parentUpdated, ...childLots];
  }

  if (action.type === 'merger' && linkedSymbol) {
    const conv = Math.max(0, Number(action.conversionRatio) || 1);
    const childSym = linkedSymbol.toUpperCase();
    const childLots: CostLot[] = [];
    for (const lot of symLots) {
      const grantQty = lot.quantityRemaining * conv;
      if (grantQty > 1e-9) {
        childLots.push({
          id: `ca-merge-${lot.id}-${childSym}`,
          symbol: childSym,
          acquisitionDate: lot.acquisitionDate,
          quantityRemaining: grantQty,
          costPerShare: grantQty > 0 ? (lot.quantityRemaining * lot.costPerShare) / grantQty : lot.costPerShare,
          bookCurrency: lot.bookCurrency,
        });
      }
    }
    return [...other, ...childLots];
  }

  return lots;
}

export async function rebuildCostLotsFromEvents(args: {
  portfolioId: string;
  transactions: InvestmentTransaction[];
  corporateActions: CorporateActionReplayEvent[];
  bookCurrency?: 'SAR' | 'USD';
  signal?: AbortSignal;
}): Promise<LotReplayResult> {
  const bookCurrency = args.bookCurrency ?? 'SAR';
  let internalLots: CostLot[] = [];
  const realizedPnLBySymbol = new Map<string, number>();
  const realizedPnLByTransactionId = new Map<string, number>();

  type TimelineItem =
    | { kind: 'tx'; at: string; tx: InvestmentTransaction }
    | { kind: 'ca'; at: string; ev: CorporateActionReplayEvent };

  const portfolioTxs = args.transactions.filter(
    (t) => t.portfolioId === args.portfolioId || !t.portfolioId,
  );
  const timeline: TimelineItem[] = [];
  for (const tx of sortInvestmentTransactionsChronological(portfolioTxs)) {
    timeline.push({ kind: 'tx', at: String(tx.date ?? '').slice(0, 10), tx });
  }
  for (const ev of args.corporateActions) {
    timeline.push({ kind: 'ca', at: ev.executionDate, ev });
  }
  timeline.sort((a, b) => {
    const d = a.at.localeCompare(b.at);
    if (d !== 0) return d;
    return a.kind === 'tx' ? -1 : 1;
  });

  for (let i = 0; i < timeline.length; i++) {
    if (args.signal?.aborted) break;
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToMain();

    const item = timeline[i]!;
    if (item.kind === 'tx') {
      const tx = item.tx;
      const sym = String(tx.symbol ?? '').trim().toUpperCase();
      const qty = Math.abs(Number(tx.quantity) || 0);
      const total = Math.abs(Number(tx.total) || Number(tx.price) * qty || 0);
      const px = qty > 0 ? total / qty : Number(tx.price) || 0;
      const txBook: 'SAR' | 'USD' =
        tx.currency === 'USD' || tx.currency === 'SAR' ? tx.currency : bookCurrency;

      if (tx.type === 'buy' && sym && qty > 0) {
        internalLots.push(
          openCostLotFromBuy({
            id: `lot-${tx.id}`,
            symbol: sym,
            acquisitionDate: String(tx.date ?? '').slice(0, 10),
            quantity: qty,
            costPerShare: px,
            bookCurrency: txBook,
          }),
        );
      } else if (tx.type === 'sell' && sym && qty > 0) {
        const { allocations, remainingLots } = allocateFifoSell(internalLots, sym, qty, px);
        internalLots = remainingLots;
        let txRealized = 0;
        for (const a of allocations) {
          txRealized += a.realizedPnL;
        }
        if (tx.id) realizedPnLByTransactionId.set(String(tx.id), txRealized);
        realizedPnLBySymbol.set(sym, (realizedPnLBySymbol.get(sym) ?? 0) + txRealized);
      }
    } else {
      internalLots = applyCorporateActionToCostLots(
        internalLots,
        item.ev.symbol,
        item.ev.action,
        item.ev.action.linkedSymbol,
      );
    }
  }

  const lots: InvestmentCostLot[] = internalLots
    .filter((l) => l.quantityRemaining > 1e-9)
    .map((l) =>
      costLotToInvestmentCostLot({
        id: l.id,
        portfolioId: args.portfolioId,
        symbol: l.symbol,
        acquisitionDate: l.acquisitionDate,
        quantityRemaining: l.quantityRemaining,
        costPerShare: l.costPerShare,
        bookCurrency: l.bookCurrency,
        sourceTransactionId: l.id.startsWith('lot-') ? l.id.slice(4) : null,
      }),
    );

  return { lots, realizedPnLBySymbol, realizedPnLByTransactionId };
}
