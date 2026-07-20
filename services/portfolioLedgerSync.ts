/**
 * Unified portfolio ledger sync — holdings (WAC replay) + FIFO cost lots after any trade or corporate action.
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

export async function syncPortfolioLedgerAfterChange(
  args: SyncPortfolioLedgerArgs,
): Promise<{ lots: InvestmentCostLot[]; realizedPnLBySymbol: Map<string, number> }> {
  const portfolioId = args.portfolio.id;
  const caReplay = corporateEventsToReplay(args.corporateActionEvents, portfolioId);

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
  });

  const bookCurrency: 'SAR' | 'USD' = args.portfolio.currency === 'USD' ? 'USD' : 'SAR';
  const lotResult = await rebuildCostLotsFromEvents({
    portfolioId,
    transactions: args.investmentTransactions,
    corporateActions: caReplay,
    bookCurrency,
    holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
  });

  /**
   * Patch realized PnL only — never spread pre-sync holding qty/avgCost.
   * Spreading `args.portfolio.holdings` here rewrote sells back to pre-trade quantities.
   */
  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const upper = String(sym).toUpperCase();
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
      // Holdings already match the trade; do not fail the sell/buy because lots failed.
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
