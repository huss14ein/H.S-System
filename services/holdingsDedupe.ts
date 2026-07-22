/**
 * Safe duplicate holdings resolution — never sum disagreeing quantities.
 * Summing ghosts (e.g. LCID 500 + 1390 → 1890) was resurrecting historical books after trades.
 */
import type { Holding, InvestmentTransaction } from '../types';
import { roundQuantity } from '../utils/money';

const QTY_EPS = 1e-6;

export function ledgerNetQtyForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: Pick<InvestmentTransaction, 'portfolioId' | 'symbol' | 'type' | 'quantity'>[];
}): number {
  const sym = String(args.symbol ?? '').trim().toUpperCase();
  const pf = String(args.portfolioId ?? '');
  let net = 0;
  for (const t of args.transactions ?? []) {
    if (String(t.portfolioId ?? '') !== pf) continue;
    if (String(t.symbol ?? '').trim().toUpperCase() !== sym) continue;
    const q = Math.max(0, Number(t.quantity) || 0);
    if (t.type === 'buy') net += q;
    else if (t.type === 'sell') net -= q;
  }
  return roundQuantity(Math.max(0, net));
}

export type DuplicateHoldingsResolveResult = {
  keep: Holding;
  deleteIds: string[];
  disagreed: boolean;
  discardedQuantities: number[];
};

function qtyOf(h: Holding): number {
  return Math.max(0, Number(h.quantity) || 0);
}

function pickNewest(holdings: Holding[]): Holding {
  return [...holdings].sort((a, b) => String(b.id).localeCompare(String(a.id)))[0]!;
}

/**
 * Resolve duplicate (portfolio, symbol) rows into one canonical holding.
 * Never sums disagreeing quantities — that inflated LCID from 500 → 1890.
 */
export function resolveDuplicateHoldingsGroup(args: {
  holdings: Holding[];
  portfolioId: string;
  symbol?: string;
  transactions?: Pick<InvestmentTransaction, 'portfolioId' | 'symbol' | 'type' | 'quantity'>[];
}): DuplicateHoldingsResolveResult {
  const group = (args.holdings ?? []).filter((h) => h?.id);
  if (group.length === 0) {
    throw new Error('resolveDuplicateHoldingsGroup requires at least one holding.');
  }
  if (group.length === 1) {
    return { keep: group[0]!, deleteIds: [], disagreed: false, discardedQuantities: [] };
  }

  const qtys = group.map(qtyOf);
  const allSame = qtys.every((q) => Math.abs(q - qtys[0]!) <= QTY_EPS);
  if (allSame) {
    const keep = pickNewest(group);
    return {
      keep,
      deleteIds: group.filter((h) => h.id !== keep.id).map((h) => h.id),
      disagreed: false,
      discardedQuantities: [],
    };
  }

  const symbol =
    String(args.symbol ?? group[0]?.symbol ?? '')
      .trim()
      .toUpperCase() || '';
  let keep: Holding = pickNewest(group);
  if (symbol && args.transactions && args.portfolioId) {
    const ledgerNet = ledgerNetQtyForSymbol({
      portfolioId: args.portfolioId,
      symbol,
      transactions: args.transactions,
    });
    const exactMatches = group.filter((h) => Math.abs(qtyOf(h) - ledgerNet) <= QTY_EPS);
    if (exactMatches.length > 0) {
      // Exact ledger match only — never "nearest" (that preferred 1390 over 500 when ledger was 1890).
      keep = pickNewest(exactMatches);
    }
    // No exact match: keep newest id; never sum disagreeing qtys.
  }

  const deleteIds = group.filter((h) => h.id !== keep.id).map((h) => h.id);
  const discardedQuantities = group.filter((h) => h.id !== keep.id).map(qtyOf);
  return {
    keep,
    deleteIds,
    disagreed: true,
    discardedQuantities,
  };
}
