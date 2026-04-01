import type { Holding, InvestmentTransaction } from '../types';
import { isInvestmentTransactionType } from '../utils/investmentTransactionType';

export function weightedAverageCost(h: Holding): number {
  const q = Number(h.quantity) || 0;
  if (q <= 0) return 0;
  return Number(h.avgCost) || 0;
}

export function unrealizedPnL(h: Holding): number {
  const costBasis = (Number(h.quantity) || 0) * (Number(h.avgCost) || 0);
  return (Number(h.currentValue) || 0) - costBasis;
}

/** Sums sell totals minus buy totals for symbol (simple realized, not FIFO). */
export function realizedPnLFromTrades(
  symbol: string,
  txs: InvestmentTransaction[]
): number {
  let buys = 0;
  let sells = 0;
  txs.forEach((t) => {
    if (String(t.symbol).toUpperCase() !== String(symbol).toUpperCase()) return;
    if (isInvestmentTransactionType(t.type, 'buy')) buys += Math.abs(Number(t.total) || 0);
    if (isInvestmentTransactionType(t.type, 'sell')) sells += Math.abs(Number(t.total) || 0);
  });
  return sells - buys;
}

export function breakEvenPrice(h: Holding): number {
  const q = Number(h.quantity) || 0;
  if (q <= 0) return 0;
  return (Number(h.avgCost) || 0);
}

/** Yield on cost: dividendYield (on price) × (currentValue / costBasis). */
export function dividendYieldOnCost(h: Holding): number {
  const cost = (Number(h.quantity) || 0) * (Number(h.avgCost) || 0);
  const y = Number(h.dividendYield) || 0;
  if (cost <= 0) return y;
  const currentVal = Number(h.currentValue) || 0;
  if (currentVal <= 0) return y;
  return y * (currentVal / cost);
}
