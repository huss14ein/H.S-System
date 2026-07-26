/**
 * Targeted historical replay for reconciliation runs.
 * Processes only affected entities/symbols — never a whole-book bulk rebuild by default.
 */
import type { FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../../types';
import type { CorporateAction } from '../corporateActions';
import { filterTransactionsForPortfolioReplay } from '../portfolioTransactionScope';
import { rebuildPortfolioFromEvents } from '../portfolioReplayEngine';
import type { ReconciliationRun } from './types';
import { appCalendarTodayYmd, yearMonthFromYmd } from './constants';
import { isMonthLocked } from '../netWorthSnapshot';
import { corporateActionFromEvent } from '../corporateActionApply';

export interface ReplayRequest {
  portfolioId: string;
  symbols: string[];
  effectiveFrom: string;
  adjustmentId?: string;
  /** When true, missing historical marks block the run instead of inventing prices. */
  requireHistoricalMarks?: boolean;
  historicalMarksBySymbolDay?: Record<string, number>;
}

export interface ReplayResult {
  status: ReconciliationRun['status'];
  holdings?: Map<string, Holding>;
  errorMessage?: string;
  missingMarks?: string[];
}

export function collectMissingMarks(args: {
  symbols: string[];
  effectiveFrom: string;
  throughDate?: string;
  marks?: Record<string, number>;
}): string[] {
  const through = (args.throughDate || appCalendarTodayYmd()).slice(0, 10);
  const from = args.effectiveFrom.slice(0, 10);
  if (from >= through) return [];
  const missing: string[] = [];
  for (const sym of args.symbols) {
    const key = `${sym.toUpperCase()}|${from}`;
    const v = args.marks?.[key] ?? args.marks?.[sym.toUpperCase()];
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) {
      missing.push(sym.toUpperCase());
    }
  }
  return missing;
}

export async function replayAffectedPortfolioSymbols(args: {
  data: FinancialData;
  request: ReplayRequest;
}): Promise<ReplayResult> {
  const { data, request } = args;
  const portfolio = (data.investments ?? []).find((p) => p.id === request.portfolioId) as
    | InvestmentPortfolio
    | undefined;
  if (!portfolio) {
    return { status: 'failed', errorMessage: 'Portfolio not found.' };
  }

  if (isMonthLocked(yearMonthFromYmd(request.effectiveFrom))) {
    return {
      status: 'blocked',
      errorMessage: `Month ${yearMonthFromYmd(request.effectiveFrom)} is locked — cannot rewrite historical projections silently.`,
    };
  }

  const symbols = request.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (request.requireHistoricalMarks) {
    const missing = collectMissingMarks({
      symbols,
      effectiveFrom: request.effectiveFrom,
      marks: request.historicalMarksBySymbolDay,
    });
    if (missing.length) {
      return {
        status: 'blocked',
        errorMessage: `Missing historical marks for ${missing.join(', ')} — retry after marks are available. ROI was not invented.`,
        missingMarks: missing,
      };
    }
  }

  const txs = filterTransactionsForPortfolioReplay({
    portfolioId: portfolio.id,
    transactions: data.investmentTransactions ?? [],
    holdingSymbols: symbols.length ? symbols : portfolio.holdings?.map((h) => String(h.symbol ?? '')),
    accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
  }) as InvestmentTransaction[];

  const corporateActions = (data.corporateActionEvents ?? [])
    .filter((e) => e.portfolioId === portfolio.id && e.status !== 'reversed')
    .filter((e) => !symbols.length || symbols.includes(String(e.symbol ?? '').toUpperCase()))
    .map((e) => ({
      id: e.id,
      executionDate: e.executionDate,
      symbol: e.symbol,
      action: corporateActionFromEvent(e) as CorporateAction,
    }));

  const result = await rebuildPortfolioFromEvents({
    transactions: txs,
    corporateActions,
    fromDate: request.effectiveFrom,
  });

  if (symbols.length) {
    const filtered = new Map<string, Holding>();
    for (const [sym, h] of result.holdings.entries()) {
      if (symbols.includes(sym.toUpperCase())) filtered.set(sym, h as Holding);
    }
    return { status: 'completed', holdings: filtered };
  }
  return { status: 'completed', holdings: result.holdings as Map<string, Holding> };
}

/**
 * Corporate-action lineage metadata for a replay run.
 *
 * When a reconciliation replay rebuilds a symbol, the corporate actions that were
 * applied (splits, dividends, etc.) are part of the audit lineage. This records the
 * applied CA event ids + a summary onto the run metadata so the durable audit trail
 * (and the Edge worker's status update) can explain *why* holdings changed — instead
 * of a silent bulk rebuild.
 */
export function buildCorporateActionLineageMetadata(args: {
  data: FinancialData;
  portfolioId: string;
  symbols: string[];
  effectiveFrom: string;
}): { corporateActionIds: string[]; corporateActionSummary: string; effectiveFrom: string } {
  const symbols = args.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const applied = (args.data.corporateActionEvents ?? [])
    .filter((e) => e.portfolioId === args.portfolioId && e.status !== 'reversed')
    .filter((e) => !symbols.length || symbols.includes(String(e.symbol ?? '').toUpperCase()))
    .filter((e) => String(e.executionDate ?? '').slice(0, 10) >= args.effectiveFrom.slice(0, 10));
  return {
    corporateActionIds: applied.map((e) => e.id),
    corporateActionSummary: applied.length
      ? `${applied.length} corporate action(s) applied in lineage: ${applied
          .map((e) => `${e.symbol} ${e.actionType ?? ''}`.trim())
          .join(', ')}`
      : 'No corporate actions in replay window.',
    effectiveFrom: args.effectiveFrom.slice(0, 10),
  };
}

/** Build a pending run payload for Edge Function / SQL worker. */
export function buildReplayRunPayload(request: ReplayRequest & { userId: string }) {
  return {
    user_id: request.userId,
    status: 'pending' as const,
    effective_from: request.effectiveFrom.slice(0, 10),
    entity_type: 'holding',
    entity_ids: request.symbols,
    adjustment_id: request.adjustmentId ?? null,
    metadata: {
      portfolioId: request.portfolioId,
      requireHistoricalMarks: Boolean(request.requireHistoricalMarks),
    },
  };
}
