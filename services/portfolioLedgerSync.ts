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
  /** Manual-only portfolios: as_stored on fresh apply/undo; replay_derived on re-sync. */
  holdingsBaselineMode?: HoldingsReplayBaselineMode;
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
  const portfolioTxs = args.investmentTransactions.filter(
    (t) => t.portfolioId === portfolioId || !t.portfolioId,
  );

  const replayed = await replayPortfolioHoldingsFromEvents({
    portfolio: args.portfolio,
    transactions: args.investmentTransactions,
    corporateActionEvents: args.corporateActionEvents,
    holdingsBaselineMode: args.holdingsBaselineMode ?? 'replay_derived',
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
    transactions: portfolioTxs,
    corporateActions: caReplay,
    bookCurrency,
  });

  for (const [sym, pnl] of lotResult.realizedPnLBySymbol) {
    const h = args.portfolio.holdings.find((x) => String(x.symbol ?? '').toUpperCase() === sym);
    if (h?.id && Math.abs(pnl - (h.realizedPnL ?? 0)) > 0.01) {
      await args.updateHolding({ ...h, realizedPnL: pnl });
    }
  }

  if (args.supabase && args.userId) {
    await persistInvestmentCostLotsForPortfolio(args.supabase, args.userId, portfolioId, lotResult.lots);
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
  if (delErr && delErr.code !== 'PGRST205') throw delErr;

  if (lots.length === 0) return;

  const rows = lots.map((lot) => ({
    ...investmentCostLotToRow(lot),
    user_id: userId,
  }));

  const { error: insErr } = await supabase.from('investment_cost_lots').insert(rows);
  if (insErr && insErr.code !== 'PGRST205') throw insErr;
}
