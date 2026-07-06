/**
 * Apply corporate actions to portfolio holdings (client-side + optional DB persist).
 * KSA/US/Tadawul — cost basis for P/L, not tax reporting.
 */
import type { CorporateAction } from './corporateActions';
import {
  applyCorporateAction,
  buildCorporateActionIdempotencyKey,
  inverseCorporateAction,
  type CorporateActionType,
} from './corporateActions';
import { rebuildPortfolioFromEvents } from './portfolioReplayEngine';
import type { Holding, InvestmentPortfolio, InvestmentTransaction, CorporateActionEvent } from '../types';

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
  return {
    type,
    ratioNumerator: row.ratio_numerator != null ? Number(row.ratio_numerator) : undefined,
    ratioDenominator: row.ratio_denominator != null ? Number(row.ratio_denominator) : undefined,
    dividendPerShare: row.cash_per_share != null ? Number(row.cash_per_share) : undefined,
    cashPerShare: row.cash_per_share != null ? Number(row.cash_per_share) : undefined,
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
  return {
    portfolio_id: args.portfolioId,
    action_type: dbType as CorporateActionEventRow['action_type'],
    symbol: args.symbol.toUpperCase(),
    linked_symbol: args.linkedSymbol ?? null,
    execution_date: args.executionDate.slice(0, 10),
    ratio_numerator: args.action.ratioNumerator ?? null,
    ratio_denominator: args.action.ratioDenominator ?? null,
    cash_per_share: args.action.dividendPerShare ?? args.action.cashPerShare ?? null,
    cost_basis_allocation_pct: args.action.costBasisAllocationPct ?? null,
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

export async function replayPortfolioHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  corporateEvents: CorporateActionEventRow[];
  /** When false (default), rebuild from trades + corporate events only — avoids double-counting. */
  seedFromCurrentHoldings?: boolean;
}): Promise<Map<string, { quantity: number; avgCost: number }>> {
  const caEvents = args.corporateEvents.map((row) => ({
    id: row.id,
    executionDate: row.execution_date,
    symbol: row.symbol,
    action: corporateActionFromRow(row),
  }));
  const initialHoldings = args.seedFromCurrentHoldings
    ? args.portfolio.holdings.map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        avgCost: h.avgCost,
      }))
    : [];
  const result = await rebuildPortfolioFromEvents({
    transactions: args.transactions.filter((t) => t.portfolioId === args.portfolio.id || !t.portfolioId),
    corporateActions: caEvents,
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
    cost_basis_allocation_pct: ev.costBasisAllocationPct ?? null,
    idempotency_key: ev.idempotencyKey,
    status: ev.status,
  });
}

export function normalizeCorporateActionEventRow(row: Record<string, unknown>): CorporateActionEvent {
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
    costBasisAllocationPct:
      row.cost_basis_allocation_pct != null ? Number(row.cost_basis_allocation_pct) : undefined,
    idempotencyKey: String(row.idempotency_key ?? ''),
    status: (row.status as CorporateActionEvent['status']) ?? 'applied',
  };
}

export function corporateActionEventToRow(ev: CorporateActionEvent): CorporateActionEventRow {
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
    cost_basis_allocation_pct: ev.costBasisAllocationPct ?? null,
    idempotency_key: ev.idempotencyKey,
    status: ev.status ?? 'applied',
  };
}

export async function replayPortfolioHoldingsFromEvents(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
}): Promise<Map<string, { quantity: number; avgCost: number }>> {
  const portfolioTxs = args.transactions.filter(
    (t) => t.portfolioId === args.portfolio.id || !t.portfolioId,
  );
  const rows = args.corporateActionEvents
    .filter((e) => e.portfolioId === args.portfolio.id && e.status !== 'reversed')
    .map(corporateActionEventToRow);
  return replayPortfolioHoldings({
    portfolio: args.portfolio,
    transactions: args.transactions,
    corporateEvents: rows,
    seedFromCurrentHoldings: portfolioTxs.length === 0,
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
      await args.updateHolding({
        ...existing,
        quantity: r.quantity,
        avgCost: r.avgCost,
      });
    } else {
      await args.addHolding({
        id: `ca-replay-${upper}-${Date.now()}`,
        symbol: upper,
        name: upper,
        quantity: r.quantity,
        avgCost: r.avgCost,
        currentValue: r.quantity * r.avgCost,
        zakahClass: 'Zakatable',
        realizedPnL: 0,
        assetClass: 'Stock',
        portfolio_id: args.portfolio.id,
      });
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
