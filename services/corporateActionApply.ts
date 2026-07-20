/**
 * Apply corporate actions to portfolio holdings (client-side + optional DB persist).
 * KSA/US/Tadawul — cost basis for P/L, not tax reporting.
 */
import type { CorporateAction } from './corporateActions';
import {
  applyCorporateAction,
  buildCorporateActionIdempotencyKey,
  inverseCorporateAction,
  recalculateCostBasisAfterAction,
  type CorporateActionType,
} from './corporateActions';
import { rebuildPortfolioFromEvents } from './portfolioReplayEngine';
import type { Holding, InvestmentPortfolio, InvestmentTransaction, CorporateActionEvent } from '../types';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';
import {
  filterTransactionsForPortfolioReplay,
  hasPositionAffectingTransactions,
} from './portfolioTransactionScope';

export {
  filterTransactionsForPortfolio,
  filterTransactionsForPortfolioReplay,
} from './portfolioTransactionScope';

export type CorporateActionEventRow = {
  id: string;
  user_id?: string;
  portfolio_id: string;
  action_type: CorporateActionType | 'dividend_cash' | 'dividend_drip';
  symbol: string;
  linked_symbol?: string | null;
  execution_date: string;
  ratio_numerator?: number | null;
  ratio_denominator?: number | null;
  cash_per_share?: number | null;
  cost_basis_allocation_pct?: number | null;
  price_per_share?: number | null;
  metadata?: Record<string, unknown> | null;
  idempotency_key: string;
  status?: 'applied' | 'reversed';
};

export function corporateActionFromRow(row: CorporateActionEventRow): CorporateAction {
  const typeMap: Record<string, CorporateActionType> = {
    dividend_cash: 'cash_dividend',
    dividend_drip: 'dividend_drip',
    stock_split: 'stock_split',
    reverse_stock_split: 'reverse_stock_split',
    cash_in_lieu: 'cash_in_lieu',
    spinoff: 'spinoff',
    merger: 'merger',
  };
  const type = typeMap[String(row.action_type)] ?? (row.action_type as CorporateActionType);
  const metadata = (row as { metadata?: Record<string, unknown> }).metadata ?? {};
  const cashInLieuFromMeta =
    metadata.cashInLieuPrice != null
      ? Number(metadata.cashInLieuPrice)
      : row.price_per_share != null &&
          (type === 'reverse_stock_split' || type === 'cash_in_lieu') &&
          row.cash_per_share == null
        ? Number(row.price_per_share)
        : undefined;
  const isDividendType = type === 'cash_dividend' || type === 'dividend_drip';
  return {
    type,
    ratioNumerator: row.ratio_numerator != null ? Number(row.ratio_numerator) : undefined,
    ratioDenominator: row.ratio_denominator != null ? Number(row.ratio_denominator) : undefined,
    dividendPerShare: isDividendType && row.cash_per_share != null ? Number(row.cash_per_share) : undefined,
    cashPerShare: !isDividendType && row.cash_per_share != null ? Number(row.cash_per_share) : undefined,
    cashInLieuPrice: cashInLieuFromMeta,
    costBasisAllocationPct:
      row.cost_basis_allocation_pct != null ? Number(row.cost_basis_allocation_pct) : undefined,
    linkedSymbol: row.linked_symbol ?? undefined,
    conversionRatio:
      row.ratio_numerator != null && row.ratio_denominator
        ? Number(row.ratio_numerator) / Number(row.ratio_denominator)
        : undefined,
  };
}

export function buildCorporateActionEventPayload(args: {
  portfolioId: string;
  symbol: string;
  executionDate: string;
  action: CorporateAction;
  linkedSymbol?: string;
}): Omit<CorporateActionEventRow, 'id'> {
  const key = buildCorporateActionIdempotencyKey({
    portfolioId: args.portfolioId,
    symbol: args.symbol,
    type: args.action.type,
    date: args.executionDate,
    linked: args.linkedSymbol,
    num: args.action.ratioNumerator,
    den: args.action.ratioDenominator,
  });
  const dbType =
    args.action.type === 'cash_dividend'
      ? 'dividend_cash'
      : args.action.type === 'dividend_drip'
        ? 'dividend_drip'
        : args.action.type;
  const metadata: Record<string, unknown> = {};
  if (args.action.cashInLieuPrice != null && Number.isFinite(args.action.cashInLieuPrice)) {
    metadata.cashInLieuPrice = args.action.cashInLieuPrice;
  }
  const cashPerShare =
    args.action.type === 'cash_dividend' || args.action.type === 'dividend_drip'
      ? args.action.dividendPerShare ?? null
      : args.action.cashPerShare ?? null;
  const pricePerShare =
    args.action.cashInLieuPrice != null && Number.isFinite(args.action.cashInLieuPrice)
      ? args.action.cashInLieuPrice
      : null;
  return {
    portfolio_id: args.portfolioId,
    action_type: dbType as CorporateActionEventRow['action_type'],
    symbol: args.symbol.toUpperCase(),
    linked_symbol: args.linkedSymbol ?? null,
    execution_date: args.executionDate.slice(0, 10),
    ratio_numerator: args.action.ratioNumerator ?? null,
    ratio_denominator: args.action.ratioDenominator ?? null,
    cash_per_share: cashPerShare,
    price_per_share: pricePerShare,
    cost_basis_allocation_pct: args.action.costBasisAllocationPct ?? null,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
    idempotency_key: key,
    status: 'applied',
  };
}

/** Apply one corporate action to holdings map (in-memory). */
export function applyCorporateActionToHoldings(
  holdings: Holding[],
  symbol: string,
  action: CorporateAction,
  linkedSymbol?: string,
): Holding[] {
  const sym = symbol.toUpperCase();
  const idx = holdings.findIndex((h) => String(h.symbol ?? '').toUpperCase() === sym);
  const cur = idx >= 0 ? holdings[idx]! : null;
  const holdingLike = { quantity: cur?.quantity ?? 0, avgCost: cur?.avgCost ?? 0 };
  const applied = applyCorporateAction({ action, holding: holdingLike });
  const next = [...holdings];

  if (cur && idx >= 0) {
    if (applied.quantity > 1e-9) {
      next[idx] = { ...cur, quantity: applied.quantity, avgCost: applied.avgCost };
    } else {
      next.splice(idx, 1);
    }
  }

  if (applied.spinoffGrant || applied.mergerGrant) {
    const grant = applied.spinoffGrant ?? applied.mergerGrant!;
    const gSym = grant.symbol.toUpperCase();
    const gIdx = next.findIndex((h) => String(h.symbol ?? '').toUpperCase() === gSym);
    if (gIdx >= 0) {
      const existing = next[gIdx]!;
      const totalQty = existing.quantity + grant.quantity;
      const blendedCost =
        totalQty > 0
          ? (existing.quantity * existing.avgCost + grant.quantity * grant.avgCost) / totalQty
          : grant.avgCost;
      next[gIdx] = { ...existing, quantity: totalQty, avgCost: blendedCost };
    } else {
      next.push({
        id: `ca-${gSym}-${Date.now()}`,
        symbol: grant.symbol,
        name: grant.symbol,
        quantity: grant.quantity,
        avgCost: grant.avgCost,
        currentValue: grant.quantity * grant.avgCost,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
      });
    }
  }

  if (linkedSymbol && action.type === 'merger') {
    return next.filter((h) => String(h.symbol ?? '').toUpperCase() !== sym);
  }

  return next;
}

/** How manual-only portfolios (no buy txs) seed replay — avoids double-applying corporate actions on re-sync. */
export type HoldingsReplayBaselineMode = 'as_stored' | 'replay_derived';

export function mapPortfolioToReplayHoldings(
  portfolio: InvestmentPortfolio,
): { symbol: string; quantity: number; avgCost: number }[] {
  return portfolio.holdings
    .map((h) => ({
      symbol: String(h.symbol ?? '').toUpperCase(),
      quantity: Number(h.quantity) || 0,
      avgCost: Number(h.avgCost) || 0,
    }))
    .filter((h) => h.symbol);
}

/** Undo stored post-CA qty/avgCost to pre-timeline baseline by inverse-applying active events. */
export function deriveManualBaselineHoldingsByInverse(
  portfolio: InvestmentPortfolio,
  rows: CorporateActionEventRow[],
): { symbol: string; quantity: number; avgCost: number }[] {
  const bySymbol = new Map<string, { quantity: number; avgCost: number }>();
  for (const h of portfolio.holdings) {
    const sym = String(h.symbol ?? '').toUpperCase();
    if (!sym) continue;
    bySymbol.set(sym, { quantity: Number(h.quantity) || 0, avgCost: Number(h.avgCost) || 0 });
  }
  const sorted = [...rows]
    .filter((r) => r.status !== 'reversed')
    .sort((a, b) => String(b.execution_date).localeCompare(String(a.execution_date)));
  for (const row of sorted) {
    const sym = String(row.symbol ?? '').toUpperCase();
    const cur = bySymbol.get(sym);
    if (!cur) continue;
    const inv = inverseCorporateAction(corporateActionFromRow(row));
    const next = recalculateCostBasisAfterAction({ action: inv, holding: cur });
    bySymbol.set(sym, { quantity: next.quantity, avgCost: next.avgCost });
  }
  return [...bySymbol.entries()].map(([symbol, h]) => ({ symbol, ...h }));
}

export function resolveManualPortfolioInitialHoldings(
  portfolio: InvestmentPortfolio,
  rows: CorporateActionEventRow[],
  mode: HoldingsReplayBaselineMode,
): { symbol: string; quantity: number; avgCost: number }[] {
  const active = rows.filter((r) => r.status !== 'reversed');
  if (active.length === 0) return mapPortfolioToReplayHoldings(portfolio);
  if (mode === 'as_stored') return mapPortfolioToReplayHoldings(portfolio);
  return deriveManualBaselineHoldingsByInverse(portfolio, rows);
}

export async function replayPortfolioHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  corporateEvents: CorporateActionEventRow[];
  holdingsBaselineMode?: HoldingsReplayBaselineMode;
}): Promise<Map<string, { quantity: number; avgCost: number }>> {
  const caEvents = args.corporateEvents
    .filter((r) => r.status !== 'reversed')
    .map((row) => ({
      id: row.id,
      executionDate: row.execution_date,
      symbol: row.symbol,
      action: corporateActionFromRow(row),
    }));
  const portfolioTxs = filterTransactionsForPortfolioReplay({
    portfolioId: args.portfolio.id,
    transactions: args.transactions,
    holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });
  let initialHoldings: { symbol: string; quantity: number; avgCost: number }[] = [];
  const tradedSymbols = new Set<string>();
  const symbolsWithBuys = new Set<string>();
  for (const t of portfolioTxs) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    tradedSymbols.add(sym);
    if (t.type === 'buy') symbolsWithBuys.add(sym);
  }
  /** Manual books that only have sells — qty is patched in recordTrade; replaying sells would double-apply. */
  const sellOnlySymbols = new Set(
    [...tradedSymbols].filter((sym) => !symbolsWithBuys.has(sym)),
  );

  if (tradedSymbols.size === 0) {
    const mode = args.holdingsBaselineMode ?? 'replay_derived';
    initialHoldings = resolveManualPortfolioInitialHoldings(args.portfolio, args.corporateEvents, mode);
  } else {
    /**
     * Hybrid baseline:
     * - Symbols with buy txs rebuild from 0 (ledger is source of truth).
     * - Manual-only + sell-only symbols keep as_stored qty (selling LCID must not wipe UNH;
     *   sell-only qty is reduced in recordTrade before sync so re-sync stays idempotent).
     * Corporate actions for non-traded symbols are skipped below (already baked into stored qty).
     */
    initialHoldings = mapPortfolioToReplayHoldings(args.portfolio).filter(
      (h) => !symbolsWithBuys.has(h.symbol.toUpperCase()),
    );
  }

  const caEventsForReplay =
    tradedSymbols.size === 0
      ? caEvents
      : caEvents.filter((e) => tradedSymbols.has(String(e.symbol ?? '').toUpperCase()));

  const txsForHoldingsReplay =
    sellOnlySymbols.size === 0
      ? portfolioTxs
      : portfolioTxs.filter((t) => {
          if (t.type !== 'buy' && t.type !== 'sell') return true;
          const sym = String(t.symbol ?? '').trim().toUpperCase();
          return !sym || !sellOnlySymbols.has(sym);
        });

  const result = await rebuildPortfolioFromEvents({
    transactions: txsForHoldingsReplay,
    corporateActions: caEventsForReplay,
    initialHoldings,
  });
  return result.holdings;
}

export function buildReverseCorporateAction(action: CorporateAction): CorporateAction {
  return inverseCorporateAction(action);
}

export function corporateActionFromEvent(ev: CorporateActionEvent): CorporateAction {
  return corporateActionFromRow({
    id: ev.id,
    portfolio_id: ev.portfolioId,
    action_type: ev.actionType,
    symbol: ev.symbol,
    linked_symbol: ev.linkedSymbol ?? null,
    execution_date: ev.executionDate,
    ratio_numerator: ev.ratioNumerator ?? null,
    ratio_denominator: ev.ratioDenominator ?? null,
    cash_per_share: ev.cashPerShare ?? null,
    price_per_share: ev.cashInLieuPrice ?? null,
    metadata: ev.cashInLieuPrice != null ? { cashInLieuPrice: ev.cashInLieuPrice } : {},
    cost_basis_allocation_pct: ev.costBasisAllocationPct ?? null,
    idempotency_key: ev.idempotencyKey,
    status: ev.status,
  });
}

export function normalizeCorporateActionEventRow(row: Record<string, unknown>): CorporateActionEvent {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const cashInLieuPrice =
    metadata.cashInLieuPrice != null
      ? Number(metadata.cashInLieuPrice)
      : row.price_per_share != null &&
          (row.action_type === 'reverse_stock_split' || row.action_type === 'cash_in_lieu')
        ? Number(row.price_per_share)
        : undefined;
  return {
    id: String(row.id ?? ''),
    user_id: row.user_id as string | undefined,
    portfolioId: String(row.portfolio_id ?? ''),
    actionType: row.action_type as CorporateActionEvent['actionType'],
    symbol: String(row.symbol ?? ''),
    linkedSymbol: (row.linked_symbol as string | null) ?? undefined,
    executionDate: String(row.execution_date ?? ''),
    ratioNumerator: row.ratio_numerator != null ? Number(row.ratio_numerator) : undefined,
    ratioDenominator: row.ratio_denominator != null ? Number(row.ratio_denominator) : undefined,
    cashPerShare: row.cash_per_share != null ? Number(row.cash_per_share) : undefined,
    cashInLieuPrice: cashInLieuPrice != null && Number.isFinite(cashInLieuPrice) ? cashInLieuPrice : undefined,
    costBasisAllocationPct:
      row.cost_basis_allocation_pct != null ? Number(row.cost_basis_allocation_pct) : undefined,
    idempotencyKey: String(row.idempotency_key ?? ''),
    status: (row.status as CorporateActionEvent['status']) ?? 'applied',
  };
}

export function corporateActionEventToRow(ev: CorporateActionEvent): CorporateActionEventRow {
  const metadata: Record<string, unknown> = {};
  if (ev.cashInLieuPrice != null && Number.isFinite(ev.cashInLieuPrice)) {
    metadata.cashInLieuPrice = ev.cashInLieuPrice;
  }
  return {
    id: ev.id,
    portfolio_id: ev.portfolioId,
    action_type: ev.actionType,
    symbol: ev.symbol,
    linked_symbol: ev.linkedSymbol ?? null,
    execution_date: ev.executionDate,
    ratio_numerator: ev.ratioNumerator ?? null,
    ratio_denominator: ev.ratioDenominator ?? null,
    cash_per_share: ev.cashPerShare ?? null,
    price_per_share: ev.cashInLieuPrice ?? null,
    cost_basis_allocation_pct: ev.costBasisAllocationPct ?? null,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
    idempotency_key: ev.idempotencyKey,
    status: ev.status ?? 'applied',
  };
}

export async function replayPortfolioHoldingsFromEvents(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  holdingsBaselineMode?: HoldingsReplayBaselineMode;
  /**
   * When set, holdings replay uses only these events (still portfolio-scoped).
   * Use on fresh CA apply/undo with `as_stored` so prior events already baked into
   * stored qty are not applied again.
   */
  holdingsReplayEvents?: CorporateActionEvent[];
}): Promise<Map<string, { quantity: number; avgCost: number }>> {
  const portfolioTxs = filterTransactionsForPortfolioReplay({
    portfolioId: args.portfolio.id,
    transactions: args.transactions,
    holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });
  const eventSource = args.holdingsReplayEvents ?? args.corporateActionEvents;
  const rows = eventSource
    .filter((e) => e.portfolioId === args.portfolio.id && e.status !== 'reversed')
    .map(corporateActionEventToRow);
  return replayPortfolioHoldings({
    portfolio: args.portfolio,
    transactions: args.transactions,
    corporateEvents: rows,
    holdingsBaselineMode:
      args.holdingsBaselineMode ?? (!hasPositionAffectingTransactions(portfolioTxs) ? 'replay_derived' : undefined),
  });
}

export async function persistHoldingsFromReplayMap(args: {
  portfolio: InvestmentPortfolio;
  replayed: Map<string, { quantity: number; avgCost: number }>;
  updateHolding: (h: Holding) => Promise<void>;
  addHolding: (h: Holding & { portfolio_id?: string }) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
}): Promise<void> {
  const portfolioBySym = new Map(
    args.portfolio.holdings.map((h) => [String(h.symbol ?? '').toUpperCase(), h]),
  );

  for (const [sym, r] of args.replayed) {
    const upper = sym.toUpperCase();
    const existing = portfolioBySym.get(upper);
    if (r.quantity < 1e-9) {
      if (existing?.id) await args.deleteHolding(existing.id);
      continue;
    }
    if (existing) {
      const prevQty = Math.max(0, Number(existing.quantity) || 0);
      const nextQty = roundQuantity(r.quantity);
      const scaledCv =
        prevQty > 1e-9
          ? roundMoney((Number(existing.currentValue) || 0) * (nextQty / prevQty))
          : nextQty * roundAvgCostPerUnit(r.avgCost);
      await args.updateHolding({
        ...existing,
        quantity: nextQty,
        avgCost: roundAvgCostPerUnit(r.avgCost),
        currentValue: scaledCv,
      });
    } else {
      await args.addHolding({
        symbol: upper,
        name: upper,
        quantity: roundQuantity(r.quantity),
        avgCost: roundAvgCostPerUnit(r.avgCost),
        currentValue: roundQuantity(r.quantity) * roundAvgCostPerUnit(r.avgCost),
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
        portfolio_id: args.portfolio.id,
      } as Holding & { portfolio_id?: string });
    }
  }

  for (const h of args.portfolio.holdings) {
    const sym = String(h.symbol ?? '').toUpperCase();
    if (!sym || !h.id) continue;
    const r = args.replayed.get(sym);
    if (!r || r.quantity < 1e-9) {
      await args.deleteHolding(h.id);
    }
  }
}

export function computeCashInLieuDepositSar(args: {
  action: CorporateAction;
  holding: { quantity: number; avgCost: number };
}): number {
  const applied = applyCorporateAction({ action: args.action, holding: args.holding });
  return Math.max(0, applied.cashInLieu ?? 0);
}

export function corporateActionCashDepositIdempotencyKey(
  actionType: 'cash_in_lieu' | 'reverse_stock_split',
  corporateActionKey: string,
): string {
  if (actionType === 'cash_in_lieu') return `cash-in-lieu|${corporateActionKey}`;
  return `reverse-split-fraction|${corporateActionKey}`;
}

export function corporateActionCashDepositIdempotencyKeysForEvent(
  idempotencyKey: string,
): string[] {
  return [`cash-in-lieu|${idempotencyKey}`, `reverse-split-fraction|${idempotencyKey}`];
}

export function corporateActionDepositsCash(action: CorporateAction): boolean {
  return action.type === 'cash_in_lieu' || action.type === 'reverse_stock_split';
}

export function portfolioHasBuyHistoryForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
  /** Platform account — lets same-account orphan buys (pre-portfolio_id) count. */
  accountId?: string | null;
  holdingSymbols?: Iterable<string>;
}): boolean {
  const sym = args.symbol.toUpperCase();
  const scoped = filterTransactionsForPortfolioReplay({
    portfolioId: args.portfolioId,
    transactions: args.transactions,
    holdingSymbols: args.holdingSymbols ?? [sym],
    accountId: args.accountId,
  });
  return scoped.some(
    (t) => String(t.symbol ?? '').toUpperCase() === sym && t.type === 'buy',
  );
}

export function portfolioHasAppliedCorporateActionForSymbol(args: {
  portfolioId: string;
  symbol: string;
  corporateActionEvents: CorporateActionEvent[];
}): boolean {
  const sym = args.symbol.toUpperCase();
  return args.corporateActionEvents.some(
    (e) =>
      e.portfolioId === args.portfolioId &&
      e.status !== 'reversed' &&
      String(e.symbol ?? '').toUpperCase() === sym,
  );
}

export function validateCorporateActionApplyPrerequisites(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  accountId?: string | null;
  holdingSymbols?: Iterable<string>;
}): { valid: boolean; error?: string } {
  const hasBuys = portfolioHasBuyHistoryForSymbol(args);
  if (hasBuys) return { valid: true };
  if (
    portfolioHasAppliedCorporateActionForSymbol({
      portfolioId: args.portfolioId,
      symbol: args.symbol,
      corporateActionEvents: args.corporateActionEvents,
    })
  ) {
    return {
      valid: false,
      error:
        'Record a buy transaction for this symbol before applying another corporate action, or replay may double-adjust manual holdings.',
    };
  }
  return {
    valid: true,
  };
}
