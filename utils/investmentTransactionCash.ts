import type { InvestmentTransaction } from '../types';

/**
 * Returns the effective cash amount for an investment transaction.
 * Prefers stored `total`, then legacy `amount`, then derives from quantity×price (+/- fees for buy/sell).
 */
export function getInvestmentTransactionCashAmount(tx: Partial<InvestmentTransaction> & { amount?: number; fees?: number }): number {
  const type = String(tx.type ?? '').toLowerCase();
  const total = Number((tx as any).total ?? tx.amount ?? 0);
  if (Number.isFinite(total) && total > 0) return total;

  const qty = Number(tx.quantity ?? 0);
  const price = Number(tx.price ?? 0);
  const fees = Math.max(0, Number((tx as any).fees ?? 0));
  const basis = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
  if (!(basis > 0)) return 0;

  if (type === 'buy') return basis + fees;
  if (type === 'sell') return Math.max(0, basis - fees);
  return basis;
}
