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

export type MissingLedgerHoldingRow = {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  ledgerNet: number;
  /** Chronological last buy/sell on strict portfolio_id ledger. */
  lastLeg: 'buy' | 'sell' | null;
  /**
   * True when ledger net > 0 and the last buy/sell is a buy — position should be open
   * (trade in log / no holding). False when last leg is sell or unknown (sold / incomplete).
   */
  likelyOpen: boolean;
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

export function ledgerNetAndLastLegForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
}): { net: number; lastLeg: 'buy' | 'sell' | null } {
  const sym = String(args.symbol ?? '').trim().toUpperCase();
  const scoped = filterTransactionsForPortfolio(args.portfolioId, args.transactions).filter((t) => {
    if (t.type !== 'buy' && t.type !== 'sell') return false;
    return String(t.symbol ?? '').trim().toUpperCase() === sym;
  });
  let net = 0;
  let lastLeg: 'buy' | 'sell' | null = null;
  const sorted = [...scoped].sort((a, b) => {
    const da = String(a.date ?? '');
    const db = String(b.date ?? '');
    if (da !== db) return da.localeCompare(db);
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  for (const t of sorted) {
    const q = Math.max(0, Number(t.quantity) || 0);
    if (t.type === 'buy') {
      net += q;
      lastLeg = 'buy';
    } else {
      net -= q;
      lastLeg = 'sell';
    }
  }
  return { net: Math.max(0, net), lastLeg };
}

/** Symbols on the ledger for a portfolio that are not currently held (possible resurrection candidates if rebuilt). */
export function listLedgerSymbolsMissingFromHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
}): string[] {
  return classifyMissingLedgerHoldings(args).map((r) => r.symbol);
}

/**
 * Classify missing holdings: likelyOpen (last leg buy + net > 0) vs sold/incomplete (last leg sell).
 * Never auto-resurrects — callers use this for UI / opt-in restore only.
 */
export function classifyMissingLedgerHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
}): Omit<MissingLedgerHoldingRow, 'portfolioId' | 'portfolioName'>[] {
  const held = new Set(
    (args.portfolio.holdings ?? []).map((h) => String(h.symbol ?? '').trim().toUpperCase()).filter(Boolean),
  );
  const scoped = filterTransactionsForPortfolio(args.portfolio.id, args.transactions);
  const symbols = new Set<string>();
  for (const t of scoped) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (sym) symbols.add(sym);
  }
  const out: Omit<MissingLedgerHoldingRow, 'portfolioId' | 'portfolioName'>[] = [];
  for (const sym of [...symbols].sort()) {
    if (held.has(sym)) continue;
    const { net, lastLeg } = ledgerNetAndLastLegForSymbol({
      portfolioId: args.portfolio.id,
      symbol: sym,
      transactions: args.transactions,
    });
    if (net <= 1e-9) continue;
    out.push({
      symbol: sym,
      ledgerNet: net,
      lastLeg,
      likelyOpen: lastLeg === 'buy',
    });
  }
  return out;
}

export function listMissingLedgerHoldingsAcrossPortfolios(
  data: Pick<FinancialData, 'investments' | 'investmentTransactions'> | null | undefined,
): MissingLedgerHoldingRow[] {
  if (!data) return [];
  const out: MissingLedgerHoldingRow[] = [];
  for (const portfolio of getPersonalInvestments(data as FinancialData)) {
    for (const row of classifyMissingLedgerHoldings({
      portfolio,
      transactions: data.investmentTransactions ?? [],
    })) {
      out.push({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name ?? portfolio.id,
        ...row,
      });
    }
  }
  return out.sort((a, b) => {
    if (a.likelyOpen !== b.likelyOpen) return a.likelyOpen ? -1 : 1;
    return b.ledgerNet - a.ledgerNet;
  });
}
