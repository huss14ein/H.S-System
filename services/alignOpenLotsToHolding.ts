/**
 * Align FIFO open lots to the holdings book after sells / quantity reconcile.
 *
 * Two books exist: WAC on the holding (avgCost × qty) and FIFO open lots.
 * When sells (or qty-down reconcile) reduce the holding without a matching lot
 * consumption — or when broker WAC diverges from FIFO remainder — these helpers
 * bring open lots back in line without inventing ledger buy/sell rows.
 */
import { allocateFifoSell, type CostLot } from './investmentCostLots';
import type { InvestmentCostLot, InvestmentTransaction } from '../types';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';

const QTY_EPS = 1e-9;
const COST_EPS = 0.005;

export function investmentCostLotToCostLot(lot: InvestmentCostLot): CostLot {
  return {
    id: lot.id,
    symbol: String(lot.symbol ?? '').toUpperCase(),
    acquisitionDate: String(lot.acquisitionDate ?? '').slice(0, 10),
    quantityRemaining: Number(lot.quantityRemaining) || 0,
    costPerShare: Number(lot.costPerShare) || 0,
    bookCurrency: lot.bookCurrency === 'USD' ? 'USD' : 'SAR',
    sourceTransactionId: lot.sourceTransactionId ?? null,
  };
}

export function costLotToExistingInvestmentCostLot(
  lot: CostLot,
  template: Pick<InvestmentCostLot, 'portfolioId' | 'market' | 'user_id' | 'sourceCorporateActionId'>,
): InvestmentCostLot {
  return {
    id: lot.id,
    user_id: template.user_id,
    portfolioId: template.portfolioId,
    symbol: lot.symbol,
    market: template.market ?? 'US',
    acquisitionDate: lot.acquisitionDate,
    quantityRemaining: lot.quantityRemaining,
    costPerShare: lot.costPerShare,
    bookCurrency: lot.bookCurrency,
    sourceTransactionId: lot.sourceTransactionId ?? null,
    sourceCorporateActionId: template.sourceCorporateActionId ?? null,
  };
}

export function sumOpenLotQuantity(lots: { quantityRemaining?: number }[]): number {
  return lots.reduce((s, l) => s + (Number(l.quantityRemaining) || 0), 0);
}

export function sumOpenLotBookCost(lots: { quantityRemaining?: number; costPerShare?: number }[]): number {
  return roundMoney(
    lots.reduce((s, l) => s + (Number(l.quantityRemaining) || 0) * (Number(l.costPerShare) || 0), 0),
  );
}

/** Bought / sold / open from the investment ledger for one symbol (absolute quantities). */
export function summarizeSymbolTradeQuantities(
  transactions: InvestmentTransaction[] | undefined,
  symbol: string,
  opts?: { portfolioId?: string },
): { boughtQty: number; soldQty: number; netQty: number } {
  const sym = String(symbol ?? '').trim().toUpperCase();
  let boughtQty = 0;
  let soldQty = 0;
  for (const tx of transactions ?? []) {
    if (String(tx.symbol ?? '').trim().toUpperCase() !== sym) continue;
    // When scoped to a portfolio, only count rows stamped with that portfolio_id
    // (same policy as holdings qty integrity / rebuild — orphans are not silent ledger).
    if (opts?.portfolioId && String(tx.portfolioId ?? '') !== String(opts.portfolioId)) continue;
    const qty = Math.abs(Number(tx.quantity) || 0);
    if (!(qty > 0)) continue;
    if (tx.type === 'buy') boughtQty += qty;
    else if (tx.type === 'sell') soldQty += qty;
  }
  boughtQty = roundQuantity(boughtQty);
  soldQty = roundQuantity(soldQty);
  return { boughtQty, soldQty, netQty: roundQuantity(boughtQty - soldQty) };
}

/**
 * Consume excess open-lot quantity FIFO so open lots ≤ target holding qty.
 * Models "sold but not yet reflected on lots" without posting a sell row.
 */
export function alignOpenLotsToTargetQuantity(
  lots: InvestmentCostLot[],
  symbol: string,
  targetQty: number,
): { lots: InvestmentCostLot[]; consumedQty: number } {
  const sym = String(symbol ?? '').trim().toUpperCase();
  const target = Math.max(0, Number(targetQty) || 0);
  const forSym = lots.filter((l) => String(l.symbol ?? '').trim().toUpperCase() === sym);
  const others = lots.filter((l) => String(l.symbol ?? '').trim().toUpperCase() !== sym);
  const openQty = sumOpenLotQuantity(forSym);
  const excess = openQty - target;
  if (excess <= QTY_EPS || forSym.length === 0) {
    return { lots, consumedQty: 0 };
  }

  const template = forSym[0]!;
  const asCost = forSym.map(investmentCostLotToCostLot);
  const { remainingLots } = allocateFifoSell(asCost, sym, excess, 0);
  const aligned = remainingLots
    .filter((l) => l.symbol.toUpperCase() === sym && l.quantityRemaining > QTY_EPS)
    .map((l) =>
      costLotToExistingInvestmentCostLot(l, {
        portfolioId: template.portfolioId,
        market: template.market,
        user_id: template.user_id,
        sourceCorporateActionId: template.sourceCorporateActionId,
      }),
    );
  return { lots: [...others, ...aligned], consumedQty: roundQuantity(excess) };
}

/**
 * Scale each open lot's cost/share so FIFO book cost equals the holdings WAC book
 * (avgCost × qty). Preserves relative lot weights.
 */
export function rescaleOpenLotsToTargetBookCost(
  lots: InvestmentCostLot[],
  symbol: string,
  targetBookCost: number,
): InvestmentCostLot[] {
  const sym = String(symbol ?? '').trim().toUpperCase();
  const forSym = lots.filter((l) => String(l.symbol ?? '').trim().toUpperCase() === sym);
  const others = lots.filter((l) => String(l.symbol ?? '').trim().toUpperCase() !== sym);
  if (forSym.length === 0) return lots;

  const currentBook = sumOpenLotBookCost(forSym);
  const target = Math.max(0, Number(targetBookCost) || 0);
  if (Math.abs(currentBook - target) <= COST_EPS) return lots;

  if (currentBook <= COST_EPS) {
    const openQty = sumOpenLotQuantity(forSym);
    if (openQty <= QTY_EPS) return lots;
    const uniform = roundAvgCostPerUnit(target / openQty);
    return [
      ...others,
      ...forSym.map((l) => ({ ...l, costPerShare: uniform })),
    ];
  }

  const factor = target / currentBook;
  return [
    ...others,
    ...forSym.map((l) => ({
      ...l,
      costPerShare: roundAvgCostPerUnit((Number(l.costPerShare) || 0) * factor),
    })),
  ];
}

/** After lot rebuild: trim sold excess per holding, optionally match WAC book cost. */
export function alignPortfolioOpenLotsToHoldings(args: {
  lots: InvestmentCostLot[];
  holdings: { symbol?: string; quantity?: number; avgCost?: number }[];
  /** When true, also rescale FIFO book to avgCost × qty after qty alignment. */
  matchBookCost?: boolean;
}): { lots: InvestmentCostLot[]; consumedBySymbol: Record<string, number> } {
  let next = args.lots;
  const consumedBySymbol: Record<string, number> = {};
  for (const h of args.holdings ?? []) {
    const sym = String(h.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const targetQty = Math.max(0, Number(h.quantity) || 0);
    const aligned = alignOpenLotsToTargetQuantity(next, sym, targetQty);
    next = aligned.lots;
    if (aligned.consumedQty > QTY_EPS) consumedBySymbol[sym] = aligned.consumedQty;
    if (args.matchBookCost && targetQty > QTY_EPS) {
      const targetBook = roundMoney(targetQty * (Number(h.avgCost) || 0));
      next = rescaleOpenLotsToTargetBookCost(next, sym, targetBook);
    }
  }
  return { lots: next, consumedBySymbol };
}
