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
import type { CorporateActionReplayEvent } from './portfolioReplayEngine';
import { filterTransactionsForPortfolio } from './portfolioTransactionScope';
import type {
  CorporateActionEvent,
  Holding,
  InvestmentCostLot,
  InvestmentPortfolio,
  InvestmentTransaction,
} from '../types';
import { formatUnknownError } from '../utils/formatUnknownError';
import { roundAvgCostPerUnit, roundQuantity } from '../utils/money';

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
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
}): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const portfolioId = args.portfolio.id;
  const touched = normalizeTouchedSymbols(args.touchedSymbols);
  const caReplay = corporateEventsToReplay(args.corporateActionEvents, portfolioId);
  /** Strict portfolio_id — orphans must not drive automatic lots/PnL. */
  const scopedTxs = filterTransactionsForPortfolio(portfolioId, args.investmentTransactions);

  const bookCurrency: 'SAR' | 'USD' = args.portfolio.currency === 'USD' ? 'USD' : 'SAR';
  const lotResult = await rebuildCostLotsFromEvents({
    portfolioId,
    transactions: scopedTxs,
    corporateActions: caReplay,
    bookCurrency,
    /** Empty allow-list + pre-filtered txs → no orphan absorption inside lot engine. */
    holdingSymbols: [],
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });

  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const upper = String(sym).toUpperCase();
    if (touched.size > 0 && !touched.has(upper)) continue;
    const h = args.resolveHolding(upper);
    if (!h?.id) continue;
    if (Math.abs(pnl - (h.realizedPnL ?? 0)) <= 0.01) continue;
    /** Realized PnL only — never rewrite quantity / avgCost from lots. */
    await args.updateHolding({
      ...h,
      realizedPnL: pnl,
    });
  }

  if (args.supabase && args.userId) {
    try {
      await persistInvestmentCostLotsForPortfolio(args.supabase, args.userId, portfolioId, lotResult.lots);
    } catch (lotErr) {
      console.warn(
        'Cost lot persist failed after trade (position kept):',
        formatUnknownError(lotErr, 'Unknown lot persist error.'),
      );
    }
  }

  args.onLotsUpdated?.(lotResult.lots);
  return { lots: lotResult.lots, realizedPnLBySymbol: lotResult.realizedPnLBySymbol };
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
  supabase?: SupabaseClient | null;
  userId?: string;
  onLotsUpdated?: (lots: InvestmentCostLot[]) => void;
}): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const symbols = [...normalizeTouchedSymbols(args.symbols)];
  if (symbols.length === 0) {
    throw new Error('rebuildHoldingsFromLedger requires at least one symbol.');
  }
  const portfolioId = args.portfolio.id;
  const scopedTxs = filterTransactionsForPortfolio(portfolioId, args.investmentTransactions);

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

  return syncLotsAfterTrade({
    portfolio: args.portfolio,
    investmentTransactions: scopedTxs,
    corporateActionEvents: args.corporateActionEvents,
    touchedSymbols: symbols,
    resolveHolding:
      args.resolveHolding ??
      ((sym) => args.portfolio.holdings.find((h) => String(h.symbol ?? '').toUpperCase() === sym)),
    updateHolding: args.updateHolding,
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
    if (!pos || pos.quantity < 1e-9) continue;
    const h = args.portfolio.holdings.find((x) => String(x.symbol ?? '').toUpperCase() === upper);
    if (!h?.id) continue;
    if (Math.abs(pnl - (h.realizedPnL ?? 0)) <= 0.01) continue;
    await args.updateHolding({
      ...h,
      quantity: roundQuantity(pos.quantity),
      avgCost: roundAvgCostPerUnit(pos.avgCost),
      realizedPnL: pnl,
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
