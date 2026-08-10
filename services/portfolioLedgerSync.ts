/**
 * Portfolio ledger sync roles:
 * - syncLotsAfterTrade — FIFO lots + realized PnL only (trade path; never rewrites holdings qty)
 * - rebuildHoldingsFromLedger — explicit repair for named symbols only
 * - syncPortfolioLedgerAfterChange — corporate-action scoped persist (requires symbols)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  corporateActionEventToRow,
  corporateActionFromRow,
  persistHoldingsFromReplayMap,
  replayPortfolioHoldingsFromEvents,
  type HoldingsReplayBaselineMode,
} from './corporateActionApply';
import { investmentCostLotToRow } from './investmentCostLotDb';
import { rebuildCostLotsFromEvents } from './portfolioLotReplayEngine';
import { alignPortfolioOpenLotsToHoldings } from './alignOpenLotsToHolding';
import type { CorporateActionReplayEvent } from './portfolioReplayEngine';
import { filterTransactionsForPortfolio } from './portfolioTransactionScope';
import {
  buildQtyReconcileDeltaIndex,
  type QtyReconcileAdjustmentLike,
} from './holdingsIntegrityRepair';
import type {
  CorporateActionEvent,
  Holding,
  InvestmentCostLot,
  InvestmentPortfolio,
  InvestmentTransaction,
} from '../types';
import { formatUnknownError } from '../utils/formatUnknownError';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';

export type SyncPortfolioLedgerArgs = {
  portfolio: InvestmentPortfolio;
  investmentTransactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  updateHolding: (h: Holding) => Promise<void>;
  addHolding: (h: Holding & { portfolio_id?: string }) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
  /**
   * Manual-only portfolios: as_stored on fresh apply/undo (with holdingsReplayEvents = delta only);
   * replay_derived on full re-sync.
   */
  holdingsBaselineMode?: HoldingsReplayBaselineMode;
  /**
   * Holdings-only event list for as_stored delta apply/undo.
   * Lots still rebuild from full {@link corporateActionEvents}.
   */
  holdingsReplayEvents?: CorporateActionEvent[];
  /** Required — only these symbols are persisted from replay (never omit / empty). */
  symbols: string[];
};

function corporateEventsToReplay(events: CorporateActionEvent[], portfolioId: string): CorporateActionReplayEvent[] {
  return events
    .filter((e) => e.portfolioId === portfolioId && e.status !== 'reversed')
    .map((e) => {
      const row = corporateActionEventToRow(e);
      return {
        id: e.id,
        executionDate: e.executionDate,
        symbol: e.symbol,
        action: corporateActionFromRow(row),
      };
    });
}

function normalizeTouchedSymbols(symbols: Iterable<string>): Set<string> {
  return new Set([...symbols].map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean));
}

/**
 * Expand touched symbols with corporate-action linked symbols (merger / spin-off chains),
 * then restrict txs + CA replay to that closure so trade-path FIFO is O(symbol history).
 */
export function narrowLotReplayToTouchedSymbols(args: {
  touched: Set<string>;
  transactions: InvestmentTransaction[];
  corporateActions: CorporateActionReplayEvent[];
}): { transactions: InvestmentTransaction[]; corporateActions: CorporateActionReplayEvent[] } {
  if (args.touched.size === 0) {
    return { transactions: args.transactions, corporateActions: args.corporateActions };
  }
  const relevant = new Set(args.touched);
  let grew = true;
  while (grew) {
    grew = false;
    for (const ev of args.corporateActions) {
      const sym = String(ev.symbol ?? '').trim().toUpperCase();
      const linked = String(ev.action?.linkedSymbol ?? '').trim().toUpperCase();
      const hits = relevant.has(sym) || (linked ? relevant.has(linked) : false);
      if (!hits) continue;
      if (sym && !relevant.has(sym)) {
        relevant.add(sym);
        grew = true;
      }
      if (linked && !relevant.has(linked)) {
        relevant.add(linked);
        grew = true;
      }
    }
  }
  return {
    transactions: args.transactions.filter((t) =>
      relevant.has(String(t.symbol ?? '').trim().toUpperCase()),
    ),
    corporateActions: args.corporateActions.filter((ev) => {
      const sym = String(ev.symbol ?? '').trim().toUpperCase();
      const linked = String(ev.action?.linkedSymbol ?? '').trim().toUpperCase();
      return relevant.has(sym) || (linked ? relevant.has(linked) : false);
    }),
  };
}

/**
 * After buy/sell: rebuild cost lots from portfolio_id–scoped txs and patch realizedPnL only.
 * Never calls persistHoldingsFromReplayMap — position book is owned by applyPositionDeltaForTrade.
 */
export async function syncLotsAfterTrade(args: {
  portfolio: InvestmentPortfolio;
  investmentTransactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  /** Symbols whose realized PnL may be updated (typically the traded symbol). */
  touchedSymbols: string[];
  /** Resolve the current holding after position delta (from dataRef). */
  resolveHolding: (symbolUpper: string) => Holding | undefined;
  updateHolding: (h: Holding) => Promise<void>;
  /**
   * Prefer this for PnL writes. Full `updateHolding({...h, realizedPnL})` can restore a
   * stale pre-sell quantity when resolveHolding lags the position book (hydrate/dataRef race).
   */
  patchHoldingRealizedPnL?: (holdingId: string, realizedPnL: number) => Promise<void>;
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
  /**
   * Prior open lots for this portfolio (other symbols). Required when persisting
   * only touched symbols so rebuilt UUIDs do not orphan stored rows for untouched names.
   */
  existingLots?: InvestmentCostLot[];
}): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const portfolioId = args.portfolio.id;
  const touched = normalizeTouchedSymbols(args.touchedSymbols);
  const caReplayAll = corporateEventsToReplay(args.corporateActionEvents, portfolioId);
  /** Strict portfolio_id — orphans must not drive automatic lots/PnL. */
  const scopedTxsAll = filterTransactionsForPortfolio(portfolioId, args.investmentTransactions);
  const narrowed = narrowLotReplayToTouchedSymbols({
    touched,
    transactions: scopedTxsAll,
    corporateActions: caReplayAll,
  });

  const bookCurrency: 'SAR' | 'USD' = args.portfolio.currency === 'USD' ? 'USD' : 'SAR';
  const lotResult = await rebuildCostLotsFromEvents({
    portfolioId,
    transactions: narrowed.transactions,
    corporateActions: narrowed.corporateActions,
    bookCurrency,
    /** Empty allow-list + pre-filtered txs → no orphan absorption inside lot engine. */
    holdingSymbols: [],
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
    /** Trade path must not pay setTimeout yields every 100 events. */
    yieldDuringReplay: false,
  });

  /**
   * FIFO open lots must respect sold / reconciled-down quantity on the holdings book.
   * Rebuild alone only sees ledger sells; qty-down reconcile and partial scoping gaps leave
   * excess open lots — consume that excess FIFO so "Qty remaining" matches the position.
   */
  const holdingsForAlign =
    touched.size > 0
      ? (args.portfolio.holdings ?? []).filter((h) => touched.has(String(h.symbol ?? '').toUpperCase()))
      : (args.portfolio.holdings ?? []);
  /** Prefer live resolveHolding qty/avgCost after position delta. */
  const holdingsSnap = holdingsForAlign.map((h) => {
    const upper = String(h.symbol ?? '').toUpperCase();
    const live = args.resolveHolding(upper);
    return live ?? h;
  });
  const aligned = alignPortfolioOpenLotsToHoldings({
    lots: lotResult.lots,
    holdings: holdingsSnap,
    matchBookCost: false,
  });

  const rebuiltTouchedLots =
    touched.size > 0
      ? aligned.lots.filter((l) => touched.has(String(l.symbol ?? '').toUpperCase()))
      : aligned.lots;
  const preservedOtherLots =
    touched.size > 0
      ? (args.existingLots ?? []).filter(
          (l) =>
            String(l.portfolioId) === String(portfolioId) &&
            !touched.has(String(l.symbol ?? '').toUpperCase()),
        )
      : [];
  const lotsToPersist =
    touched.size > 0 ? [...preservedOtherLots, ...rebuiltTouchedLots] : aligned.lots;

  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const upper = String(sym).toUpperCase();
    if (touched.size > 0 && !touched.has(upper)) continue;
    const h = args.resolveHolding(upper);
    if (!h?.id) continue;
    const roundedPnL = roundMoney(pnl);
    if (Math.abs(roundedPnL - (h.realizedPnL ?? 0)) <= 0.01) continue;
    /**
     * Realized PnL only — never rewrite quantity / avgCost from lots (incl. qty-0 closed rows).
     * Prefer column-scoped patch so a stale resolveHolding snapshot cannot undo a sell.
     */
    if (args.patchHoldingRealizedPnL) {
      await args.patchHoldingRealizedPnL(h.id, roundedPnL);
    } else {
      await args.updateHolding({
        ...h,
        realizedPnL: roundedPnL,
      });
    }
  }

  if (args.supabase && args.userId) {
    try {
      if (touched.size > 0) {
        /** Only rewrite lots for the traded symbol(s) — avoids wipe+insert of the whole book. */
        await persistInvestmentCostLotsForSymbols(
          args.supabase,
          args.userId,
          portfolioId,
          [...touched],
          rebuiltTouchedLots,
        );
      } else {
        await persistInvestmentCostLotsForPortfolio(args.supabase, args.userId, portfolioId, lotsToPersist);
      }
    } catch (lotErr) {
      console.warn(
        'Cost lot persist failed after trade (position kept):',
        formatUnknownError(lotErr, 'Unknown lot persist error.'),
      );
    }
  }

  args.onLotsUpdated?.(lotsToPersist);
  return { lots: lotsToPersist, realizedPnLBySymbol: lotResult.realizedPnLBySymbol };
}

/**
 * Explicit repair: rebuild named symbols from portfolio_id–scoped ledger + persist only those symbols.
 */
export async function rebuildHoldingsFromLedger(args: {
  portfolio: InvestmentPortfolio;
  investmentTransactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  /** Required — never implicit "all symbols". */
  symbols: string[];
  updateHolding: (h: Holding) => Promise<void>;
  addHolding: (h: Holding & { portfolio_id?: string }) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  /** Prefer fresh lookup after persist (e.g. dataRef). */
  resolveHolding?: (symbolUpper: string) => Holding | undefined;
  /** PnL-only writer — forwarded to {@link syncLotsAfterTrade} after holdings persist. */
  patchHoldingRealizedPnL?: (holdingId: string, realizedPnL: number) => Promise<void>;
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
  /** Prior open lots for this portfolio — preserves untouched symbols during symbol-scoped lot sync. */
  existingLots?: InvestmentCostLot[];
  /**
   * Applied `reconcile_quantity` rows — Restore/Rebuild must land on effective ledger qty
   * (buys − sells + audited deltas), not raw trade lots alone.
   */
  reconciliationAdjustments?: QtyReconcileAdjustmentLike[] | null;
}): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const symbols = [...normalizeTouchedSymbols(args.symbols)];
  if (symbols.length === 0) {
    throw new Error('rebuildHoldingsFromLedger requires at least one symbol.');
  }
  const portfolioId = args.portfolio.id;
  const scopedTxs = filterTransactionsForPortfolio(portfolioId, args.investmentTransactions);
  const resolve =
    args.resolveHolding ??
    ((sym: string) => args.portfolio.holdings.find((h) => String(h.symbol ?? '').toUpperCase() === sym));

  const replayed = await replayPortfolioHoldingsFromEvents({
    portfolio: args.portfolio,
    transactions: scopedTxs,
    corporateActionEvents: args.corporateActionEvents,
    holdingsBaselineMode: 'replay_derived',
    ledgerRepairSymbols: symbols,
  });

  await persistHoldingsFromReplayMap({
    portfolio: args.portfolio,
    replayed,
    updateHolding: args.updateHolding,
    addHolding: args.addHolding,
    deleteHolding: args.deleteHolding,
    symbols,
  });

  const adjustments = args.reconciliationAdjustments ?? [];
  if (adjustments.length > 0) {
    const deltaIndex = buildQtyReconcileDeltaIndex(adjustments);
    for (const sym of symbols) {
      const reconcileDelta = deltaIndex.get(`${portfolioId}:${sym}`) ?? 0;
      if (Math.abs(reconcileDelta) < 1e-9) continue;
      /**
       * Never stack reconcile deltas onto CA-aware replay — catch-up reconciles after splits
       * would inflate qty (replay already includes the CA). Overlay only when no CA for symbol.
       */
      const hasCa = (args.corporateActionEvents ?? []).some(
        (e) =>
          e.status !== 'reversed' &&
          String(e.portfolioId ?? '') === portfolioId &&
          String(e.symbol ?? '').trim().toUpperCase() === sym,
      );
      if (hasCa) continue;
      const replayQty = Math.max(0, Number(replayed.get(sym)?.quantity) || 0);
      const qty = roundQuantity(Math.max(0, replayQty + reconcileDelta));
      const h = resolve(sym);
      if (!h?.id) continue;
      if (Math.abs((Number(h.quantity) || 0) - qty) <= 1e-6) continue;
      const markUnit =
        Number(h.currentPrice) > 0
          ? Number(h.currentPrice)
          : (Number(h.quantity) || 0) > 1e-9
            ? Number(h.currentValue || 0) / Number(h.quantity)
            : Number(h.avgCost) || 0;
      await args.updateHolding({
        ...h,
        quantity: qty,
        currentValue: qty <= 0 ? 0 : roundMoney(qty * markUnit),
      });
    }
  }

  return syncLotsAfterTrade({
    portfolio: args.portfolio,
    investmentTransactions: scopedTxs,
    corporateActionEvents: args.corporateActionEvents,
    touchedSymbols: symbols,
    existingLots: args.existingLots ?? [],
    resolveHolding: resolve,
    updateHolding: args.updateHolding,
    patchHoldingRealizedPnL: args.patchHoldingRealizedPnL,
    supabase: args.supabase,
    userId: args.userId,
    onLotsUpdated: args.onLotsUpdated,
  });
}

/**
 * Corporate-action sync: replay then persist only {@link SyncPortfolioLedgerArgs.symbols}.
 * Trade path must use {@link syncLotsAfterTrade} — never this function without an explicit symbol list.
 */
export async function syncPortfolioLedgerAfterChange(
  args: SyncPortfolioLedgerArgs,
): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const portfolioId = args.portfolio.id;
  const caReplay = corporateEventsToReplay(args.corporateActionEvents, portfolioId);
  const scopedSymbols = [...normalizeTouchedSymbols(args.symbols)];
  if (scopedSymbols.length === 0) {
    throw new Error('syncPortfolioLedgerAfterChange requires at least one symbol.');
  }

  const replayed = await replayPortfolioHoldingsFromEvents({
    portfolio: args.portfolio,
    transactions: args.investmentTransactions,
    corporateActionEvents: args.corporateActionEvents,
    holdingsBaselineMode: args.holdingsBaselineMode ?? 'replay_derived',
    holdingsReplayEvents: args.holdingsReplayEvents,
  });

  await persistHoldingsFromReplayMap({
    portfolio: args.portfolio,
    replayed,
    updateHolding: args.updateHolding,
    addHolding: args.addHolding,
    deleteHolding: args.deleteHolding,
    symbols: scopedSymbols,
  });

  const bookCurrency: 'SAR' | 'USD' = args.portfolio.currency === 'USD' ? 'USD' : 'SAR';
  const lotResult = await rebuildCostLotsFromEvents({
    portfolioId,
    /** Match holdings replay scope so CA sync cannot split holdings and FIFO lots across different ledgers. */
    transactions: args.investmentTransactions,
    corporateActions: caReplay,
    bookCurrency,
    holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });

  /**
   * Patch realized PnL after persist. Use replayed qty/avgCost when present so we never
   * spread a stale pre-persist holding snapshot (which rewrote sells back to old qty).
   * Trade path must use {@link syncLotsAfterTrade} instead (PnL-only via resolveHolding).
   */
  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const upper = String(sym).toUpperCase();
    if (!scopedSymbols.includes(upper)) continue;
    const pos = replayed.get(upper);
    const h = args.portfolio.holdings.find((x) => String(x.symbol ?? '').toUpperCase() === upper);
    if (!h?.id) continue;
    if (Math.abs(pnl - (h.realizedPnL ?? 0)) <= 0.01 && (!pos || Math.abs((h.quantity ?? 0) - pos.quantity) <= 1e-9)) {
      continue;
    }
    const openQty = pos && pos.quantity >= 1e-9;
    await args.updateHolding({
      ...h,
      ...(openQty
        ? {
            quantity: roundQuantity(pos!.quantity),
            avgCost: roundAvgCostPerUnit(pos!.avgCost),
          }
        : {
            quantity: 0,
            currentValue: 0,
          }),
      realizedPnL: roundMoney(pnl),
    });
  }

  if (args.supabase && args.userId) {
    try {
      await persistInvestmentCostLotsForPortfolio(args.supabase, args.userId, portfolioId, lotResult.lots);
    } catch (lotErr) {
      console.warn(
        'Cost lot persist failed after holdings sync (trade kept):',
        formatUnknownError(lotErr, 'Unknown lot persist error.'),
      );
    }
  }

  args.onLotsUpdated?.(lotResult.lots);
  return { lots: lotResult.lots, realizedPnLBySymbol: lotResult.realizedPnLBySymbol };
}

/**
 * Repair persisted realized P/L on holdings from portfolio-scoped ledger + FIFO lots.
 * Creates qty-0 stub rows for fully exited symbols that still have sell P/L in the ledger.
 */
export async function backfillRealizedPnLForPortfolio(args: {
  portfolio: InvestmentPortfolio;
  investmentTransactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
  updateHolding: (h: Holding) => Promise<void>;
  addHolding?: (h: Holding & { portfolio_id?: string }) => Promise<void>;
  resolveHolding?: (symbolUpper: string) => Holding | undefined;
  /** Prefer PnL-only writes so backfill cannot restore a stale quantity snapshot. */
  patchHoldingRealizedPnL?: (holdingId: string, realizedPnL: number) => Promise<void>;
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
}): Promise<{ patchedSymbols: number; lots: InvestmentCostLot[] }> {
  const portfolioId = args.portfolio.id;
  const scopedTxs = filterTransactionsForPortfolio(portfolioId, args.investmentTransactions);
  const caReplay = corporateEventsToReplay(args.corporateActionEvents, portfolioId);
  const bookCurrency: 'SAR' | 'USD' = args.portfolio.currency === 'USD' ? 'USD' : 'SAR';
  const lotResult = await rebuildCostLotsFromEvents({
    portfolioId,
    transactions: scopedTxs,
    corporateActions: caReplay,
    bookCurrency,
    holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });

  const resolve =
    args.resolveHolding ??
    ((sym: string) => args.portfolio.holdings.find((h) => String(h.symbol ?? '').toUpperCase() === sym));

  let patchedSymbols = 0;
  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const upper = String(sym).toUpperCase();
    if (!Number.isFinite(pnl) || Math.abs(pnl) < 0.01) continue;
    const rounded = roundMoney(pnl);
    let h = resolve(upper);
    if (!h?.id && args.addHolding) {
      await args.addHolding({
        symbol: upper,
        name: upper,
        quantity: 0,
        avgCost: 0,
        currentValue: 0,
        realizedPnL: rounded,
        zakahClass: 'Zakatable',
        assetClass: 'Stock',
        portfolio_id: portfolioId,
      } as Holding & { portfolio_id?: string });
      patchedSymbols += 1;
      continue;
    }
    if (!h?.id) continue;
    if (Math.abs(rounded - (h.realizedPnL ?? 0)) <= 0.01) continue;
    if (args.patchHoldingRealizedPnL) {
      await args.patchHoldingRealizedPnL(h.id, rounded);
    } else {
      await args.updateHolding({ ...h, realizedPnL: rounded });
    }
    patchedSymbols += 1;
  }

  if (args.supabase && args.userId) {
    try {
      await persistInvestmentCostLotsForPortfolio(args.supabase, args.userId, portfolioId, lotResult.lots);
    } catch (lotErr) {
      console.warn(
        'Cost lot persist failed during realized P/L backfill:',
        formatUnknownError(lotErr, 'Unknown lot persist error.'),
      );
    }
  }
  args.onLotsUpdated?.(lotResult.lots);
  return { patchedSymbols, lots: lotResult.lots };
}

export async function persistInvestmentCostLotsForPortfolio(
  supabase: SupabaseClient,
  userId: string,
  portfolioId: string,
  lots: InvestmentCostLot[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('investment_cost_lots')
    .delete()
    .match({ user_id: userId, portfolio_id: portfolioId });
  if (delErr && delErr.code !== 'PGRST205') {
    throw new Error(formatUnknownError(delErr, 'Failed to clear cost lots.'));
  }

  if (lots.length === 0) return;

  const rows = lots.map((lot) => ({
    ...investmentCostLotToRow(lot),
    user_id: userId,
  }));

  const { error: insErr } = await supabase.from('investment_cost_lots').insert(rows);
  if (insErr && insErr.code !== 'PGRST205') {
    throw new Error(formatUnknownError(insErr, 'Failed to save cost lots.'));
  }
}

/**
 * Replace open lots for specific symbols only (Record Trade hot path).
 * Deletes matching symbol rows then inserts the rebuilt open lots for those symbols.
 */
export async function persistInvestmentCostLotsForSymbols(
  supabase: SupabaseClient,
  userId: string,
  portfolioId: string,
  symbols: string[],
  lots: InvestmentCostLot[],
): Promise<void> {
  const syms = [...new Set(symbols.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))];
  if (syms.length === 0) {
    await persistInvestmentCostLotsForPortfolio(supabase, userId, portfolioId, lots);
    return;
  }

  const { error: delErr } = await supabase
    .from('investment_cost_lots')
    .delete()
    .eq('user_id', userId)
    .eq('portfolio_id', portfolioId)
    .in('symbol', syms);
  if (delErr && delErr.code !== 'PGRST205') {
    throw new Error(formatUnknownError(delErr, 'Failed to clear cost lots for symbols.'));
  }

  const rows = lots
    .filter((lot) => syms.includes(String(lot.symbol ?? '').toUpperCase()))
    .map((lot) => ({
      ...investmentCostLotToRow(lot),
      user_id: userId,
    }));
  if (rows.length === 0) return;

  const { error: insErr } = await supabase.from('investment_cost_lots').insert(rows);
  if (insErr && insErr.code !== 'PGRST205') {
    throw new Error(formatUnknownError(insErr, 'Failed to save cost lots for symbols.'));
  }
}
