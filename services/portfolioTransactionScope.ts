/**
 * Scope investment ledger rows to a single portfolio.
 * Orphan rows (missing portfolioId) must not invent unrelated symbols on a portfolio,
 * but may still apply to symbols already held or present on scoped txs (legacy data).
 */
import type { InvestmentTransaction } from '../types';

export function filterTransactionsForPortfolio(
  portfolioId: string,
  transactions: InvestmentTransaction[],
): InvestmentTransaction[] {
  return transactions.filter((t) => t.portfolioId === portfolioId);
}

export type PortfolioReplayTxFilterArgs = {
  portfolioId: string;
  transactions: InvestmentTransaction[];
  /** Symbols already on the portfolio (pre-sync holdings). */
  holdingSymbols?: Iterable<string>;
  /** Investment platform account — orphans on other accounts are excluded. */
  accountId?: string | null;
};

export function hasPositionAffectingTransactions(transactions: InvestmentTransaction[]): boolean {
  return transactions.some((t) => t.type === 'buy' || t.type === 'sell');
}

/**
 * Portfolio-scoped txs plus same-account legacy orphans for allowed symbols.
 * Allowed symbols = held symbols ∪ symbols appearing on portfolio-scoped txs.
 */
export function filterTransactionsForPortfolioReplay(
  portfolioIdOrArgs: string | PortfolioReplayTxFilterArgs,
  transactions?: InvestmentTransaction[],
  holdingSymbols?: Iterable<string>,
  accountId?: string | null,
): InvestmentTransaction[] {
  const args: PortfolioReplayTxFilterArgs =
    typeof portfolioIdOrArgs === 'string'
      ? {
          portfolioId: portfolioIdOrArgs,
          transactions: transactions ?? [],
          holdingSymbols,
          accountId,
        }
      : portfolioIdOrArgs;

  const scoped = filterTransactionsForPortfolio(args.portfolioId, args.transactions);
  const allow = new Set(
    [...(args.holdingSymbols ?? [])].map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean),
  );
  for (const t of scoped) {
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (sym) allow.add(sym);
  }
  if (allow.size === 0) return scoped;

  const scopedAccountId =
    args.accountId != null && String(args.accountId).trim() !== '' ? String(args.accountId) : null;

  const byId = new Map<string, InvestmentTransaction>();
  for (const t of scoped) {
    if (t.id) byId.set(String(t.id), t);
  }
  for (const t of args.transactions) {
    if (t.portfolioId) continue;
    if (scopedAccountId && String(t.accountId ?? '') !== scopedAccountId) continue;
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (!sym || !allow.has(sym)) continue;
    const id = t.id ? String(t.id) : `orphan-${sym}-${t.date}-${t.type}-${t.quantity}`;
    if (!byId.has(id)) byId.set(id, t);
  }
  return [...byId.values()];
}
