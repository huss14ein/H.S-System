import type { InvestmentTransaction, TradeCurrency } from '../types';

/**
 * After insert, DB rows may omit `portfolio_id` / `currency` when those columns are missing.
 * Stamp the intended identity onto the in-memory transaction so holdings replay and cash FX stay correct.
 */
export function stampInvestmentTradeIdentity(
  tx: InvestmentTransaction,
  opts: { portfolioId?: string | null; currency?: TradeCurrency | string | null },
): InvestmentTransaction {
  const portfolioId =
    tx.portfolioId ||
    (opts.portfolioId != null && String(opts.portfolioId).trim() !== '' ? String(opts.portfolioId) : undefined);
  const raw = opts.currency ?? tx.currency;
  const currency: TradeCurrency | undefined = raw === 'SAR' || raw === 'USD' ? raw : tx.currency;
  if (portfolioId === tx.portfolioId && currency === tx.currency) return tx;
  return {
    ...tx,
    ...(portfolioId ? { portfolioId } : {}),
    ...(currency ? { currency } : {}),
  };
}
