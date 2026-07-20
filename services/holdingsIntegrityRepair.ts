/**
 * Holdings qty drift vs portfolio_id–scoped ledger (repair UI).
 * Orphans are excluded — same policy as automatic trade paths.
 */
import type { FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { getPersonalInvestments } from '../utils/wealthScope';
import { filterTransactionsForPortfolio } from './portfolioTransactionScope';
import { reconcileHoldings } from './reconciliationEngine';

export type HoldingsQtyDriftRow = {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  storedQuantity: number;
  ledgerQuantity: number;
  drift: number;
  ok: boolean;
};

/**
 * Per open holding: stored qty vs sum(buy−sell) on strict portfolio_id txs.
 * Closed symbols with leftover ledger buys are not listed (keep-stored is default; rebuild is opt-in per symbol).
 */
export function buildHoldingsQtyDriftReport(
  data: Pick<FinancialData, 'investments' | 'investmentTransactions' | 'accounts'> | null | undefined,
): HoldingsQtyDriftRow[] {
  if (!data) return [];
  const rows: HoldingsQtyDriftRow[] = [];
  for (const portfolio of getPersonalInvestments(data as FinancialData)) {
    const scoped = filterTransactionsForPortfolio(portfolio.id, data.investmentTransactions ?? []);
    for (const h of portfolio.holdings ?? []) {
      const symbol = String(h.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      const rec = reconcileHoldings({ holding: h, trades: scoped });
      rows.push({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name ?? portfolio.id,
        symbol,
        storedQuantity: rec.storedQuantity,
        ledgerQuantity: rec.ledgerQuantity,
        drift: rec.drift,
        ok: rec.ok,
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

export function holdingsQtyDriftNeedsAttention(rows: HoldingsQtyDriftRow[]): HoldingsQtyDriftRow[] {
  return rows.filter((r) => !r.ok);
}

/** Symbols on the ledger for a portfolio that are not currently held (possible resurrection candidates if rebuilt). */
export function listLedgerSymbolsMissingFromHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
}): string[] {
  const held = new Set(
    (args.portfolio.holdings ?? []).map((h) => String(h.symbol ?? '').trim().toUpperCase()).filter(Boolean),
  );
  const scoped = filterTransactionsForPortfolio(args.portfolio.id, args.transactions);
  const net = new Map<string, number>();
  for (const t of scoped) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const q = Math.max(0, Number(t.quantity) || 0);
    net.set(sym, (net.get(sym) ?? 0) + (t.type === 'buy' ? q : -q));
  }
  const missing: string[] = [];
  for (const [sym, qty] of net) {
    if (held.has(sym)) continue;
    if (qty > 1e-9) missing.push(sym);
  }
  return missing.sort();
}
