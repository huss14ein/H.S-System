import type { InvestmentTransaction } from '../types';

/**
 * Returns the effective cash amount for an investment transaction.
 * Prefers stored `total`, then legacy `amount`, then derives from quantity×price (+/- fees for buy/sell).
 */
export function getInvestmentTransactionCashAmount(tx: Partial<InvestmentTransaction> & { amount?: number; fees?: number }): number {
  const type = String(tx.type ?? '').toLowerCase();
  const rawTotal = Number((tx as any).total);
  if (Number.isFinite(rawTotal) && rawTotal > 0) return rawTotal;
  const rawAmount = Number(tx.amount);
  if (Number.isFinite(rawAmount) && rawAmount > 0) return rawAmount;

  if (type !== 'buy' && type !== 'sell') return 0;

  const qty = Number(tx.quantity ?? 0);
  const price = Number(tx.price ?? 0);
  const fees = Math.max(0, Number((tx as any).fees ?? 0));
  const basis = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
  if (!(basis > 0)) return 0;

  if (type === 'buy') return basis + fees;
  if (type === 'sell') return Math.max(0, basis - fees);
  return 0;
}
