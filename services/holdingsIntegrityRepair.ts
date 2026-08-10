/**
 * Holdings qty drift vs portfolio_id–scoped ledger (repair UI).
 * Orphans are excluded — same policy as automatic trade paths.
 *
 * Effective ledger:
 * - No CA: buy−sell + applied reconcile_quantity (clears ATYR-style residuals).
 * - With CA (drift): CA-aware replay only — never stack book deltas (avoids double-count).
 * - With CA (missing): CA-aware + deltas so reconcile-to-zero still clears Critical.
 */
import type { CorporateActionEvent, FinancialData, InvestmentPortfolio, InvestmentTransaction } from '../types';
import { getPersonalInvestments } from '../utils/wealthScope';
import { filterTransactionsForPortfolio } from './portfolioTransactionScope';
import { reconcileHoldingsWithCorporateActionsSync } from './reconciliationEngine';

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
   * True when effective ledger net > 0 and the last buy/sell is a buy — position should be open
   * (trade in log / no holding). False when last leg is sell or unknown (sold / incomplete).
   */
  likelyOpen: boolean;
};

export type QtyReconcileAdjustmentLike = {
  portfolioId?: string | null;
  symbol?: string | null;
  mechanism?: string | null;
  status?: string | null;
  delta?: number | null;
  reversedByAdjustmentId?: string | null;
};

/** `portfolioId:SYMBOL` → summed applied reconcile_quantity delta. */
export function buildQtyReconcileDeltaIndex(
  adjustments?: QtyReconcileAdjustmentLike[] | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const adj of adjustments ?? []) {
    if (String(adj.mechanism ?? '') !== 'reconcile_quantity') continue;
    if (String(adj.status ?? '') === 'reversed' || String(adj.status ?? '') === 'noop') continue;
    if (adj.reversedByAdjustmentId) continue;
    const pid = String(adj.portfolioId ?? '');
    const sym = String(adj.symbol ?? '').trim().toUpperCase();
    if (!pid || !sym) continue;
    const d = Number(adj.delta);
    if (!Number.isFinite(d)) continue;
    const key = `${pid}:${sym}`;
    map.set(key, (map.get(key) ?? 0) + d);
  }
  return map;
}

/** Sum of applied (non-reversed) reconcile_quantity deltas for a portfolio symbol. */
export function qtyReconcileDeltaForSymbol(args: {
  portfolioId: string;
  symbol: string;
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  /** Optional precomputed index from {@link buildQtyReconcileDeltaIndex}. */
  deltaIndex?: Map<string, number> | null;
}): number {
  const pid = String(args.portfolioId ?? '');
  const sym = String(args.symbol ?? '').trim().toUpperCase();
  if (!pid || !sym) return 0;
  if (args.deltaIndex) return args.deltaIndex.get(`${pid}:${sym}`) ?? 0;
  return buildQtyReconcileDeltaIndex(args.adjustments).get(`${pid}:${sym}`) ?? 0;
}

/**
 * Cheap invalidation key for integrity UI / notifications — qty + ledger inputs only
 * (ignores mark-to-market currentValue/price churn).
 *
 * Trade nets and reconcile deltas are keyed per `portfolioId:symbol` so offsetting
 * edits across symbols/portfolios cannot leave the fingerprint unchanged.
 */
export function buildHoldingsIntegrityFingerprint(
  data:
    | Pick<
        FinancialData,
        'investments' | 'investmentTransactions' | 'reconciliationAdjustments' | 'corporateActionEvents'
      >
    | null
    | undefined,
): string {
  if (!data) return 'empty';
  const holdingParts: string[] = [];
  for (const p of data.investments ?? []) {
    for (const h of p.holdings ?? []) {
      const sym = String(h.symbol ?? '').trim().toUpperCase();
      if (!sym) continue;
      holdingParts.push(`${p.id}:${sym}:${Math.round((Number(h.quantity) || 0) * 1e6)}`);
    }
  }
  holdingParts.sort();

  const tradeNetByKey = new Map<string, number>();
  let txCount = 0;
  let txMaxDate = '';
  for (const t of data.investmentTransactions ?? []) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const pid = String(t.portfolioId ?? '').trim();
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (!pid || !sym) continue;
    txCount += 1;
    const q = Math.round((Number(t.quantity) || 0) * 1e4);
    const key = `${pid}:${sym}`;
    tradeNetByKey.set(key, (tradeNetByKey.get(key) ?? 0) + (t.type === 'buy' ? q : -q));
    const d = String(t.date ?? '');
    if (d > txMaxDate) txMaxDate = d;
  }
  const tradeParts = [...tradeNetByKey.entries()]
    .map(([key, net]) => `${key}:${net}`)
    .sort();

  const adjNetByKey = new Map<string, number>();
  let adjCount = 0;
  for (const adj of data.reconciliationAdjustments ?? []) {
    if (String(adj.mechanism ?? '') !== 'reconcile_quantity') continue;
    if (String(adj.status ?? '') === 'reversed' || String(adj.status ?? '') === 'noop') continue;
    if ((adj as { reversedByAdjustmentId?: string }).reversedByAdjustmentId) continue;
    const pid = String(adj.portfolioId ?? '').trim();
    const sym = String(adj.symbol ?? '').trim().toUpperCase();
    if (!pid || !sym) continue;
    adjCount += 1;
    const key = `${pid}:${sym}`;
    adjNetByKey.set(key, (adjNetByKey.get(key) ?? 0) + Math.round((Number(adj.delta) || 0) * 1e4));
  }
  const adjParts = [...adjNetByKey.entries()]
    .map(([key, net]) => `${key}:${net}`)
    .sort();

  const caParts: string[] = [];
  for (const e of data.corporateActionEvents ?? []) {
    if (e.status === 'reversed') continue;
    caParts.push(
      [
        String(e.id ?? ''),
        String(e.portfolioId ?? ''),
        String(e.symbol ?? '').trim().toUpperCase(),
        String(e.actionType ?? ''),
        String(e.executionDate ?? '').slice(0, 10),
        String((e as { ratioNumerator?: number }).ratioNumerator ?? ''),
        String((e as { ratioDenominator?: number }).ratioDenominator ?? ''),
      ].join(':'),
    );
  }
  caParts.sort();
  return [
    holdingParts.join(','),
    txCount,
    tradeParts.join(','),
    txMaxDate,
    adjCount,
    adjParts.join(','),
    caParts.join(','),
  ].join('|');
}

/**
 * Buy−sell trade net (may be negative before clamp) plus reconcile_quantity deltas.
 * Returns max(0, …) as the integrity “effective ledger” qty (trade path; no CA).
 */
export function effectiveLedgerQtyForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  deltaIndex?: Map<string, number> | null;
}): { tradeNet: number; reconcileDelta: number; effectiveNet: number; lastLeg: 'buy' | 'sell' | null } {
  const trade = ledgerTradeNetAndLastLegForSymbol(args);
  const reconcileDelta = qtyReconcileDeltaForSymbol(args);
  return {
    tradeNet: trade.net,
    reconcileDelta,
    effectiveNet: Math.max(0, trade.net + reconcileDelta),
    lastLeg: trade.lastLeg,
  };
}

function symbolHasCorporateActions(
  portfolioId: string,
  symbol: string,
  events: CorporateActionEvent[] | null | undefined,
): boolean {
  const sym = symbol.trim().toUpperCase();
  for (const e of events ?? []) {
    if (e.status === 'reversed') continue;
    if (String(e.portfolioId ?? '') !== portfolioId) continue;
    if (String(e.symbol ?? '').trim().toUpperCase() === sym) return true;
  }
  return false;
}

/**
 * Effective integrity ledger qty.
 *
 * - No CA: buy−sell + applied reconcile_quantity (ATYR-style residual clears).
 * - With CA + drift: CA-aware replay only — stacking book deltas double-counts catch-up reconciles.
 * - With CA + missing: CA-aware + deltas so reconcile-to-zero still clears Critical missing.
 */
export function integrityLedgerQuantityForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  deltaIndex?: Map<string, number> | null;
  portfolio?: InvestmentPortfolio;
  corporateActionEvents?: CorporateActionEvent[] | null;
  /** `drift` = open holding compare; `missing` = no open holding / Critical residual. */
  mode: 'drift' | 'missing';
}): number {
  const trade = ledgerTradeNetAndLastLegForSymbol(args);
  const reconcileDelta = qtyReconcileDeltaForSymbol(args);
  const hasCa =
    !!args.portfolio &&
    symbolHasCorporateActions(args.portfolioId, args.symbol, args.corporateActionEvents);
  if (hasCa && args.portfolio) {
    const caQty = reconcileHoldingsWithCorporateActionsSync({
      portfolio: args.portfolio,
      symbol: args.symbol,
      transactions: args.transactions,
      corporateActionEvents: args.corporateActionEvents ?? [],
    }).ledgerQuantity;
    if (args.mode === 'drift') return Math.max(0, caQty);
    return Math.max(0, caQty + reconcileDelta);
  }
  return Math.max(0, trade.net + reconcileDelta);
}

/**
 * Per open holding: stored qty vs effective ledger (CA-aware when needed; reconcile deltas only without CA).
 */
export function buildHoldingsQtyDriftReport(
  data:
    | Pick<
        FinancialData,
        | 'investments'
        | 'investmentTransactions'
        | 'accounts'
        | 'reconciliationAdjustments'
        | 'corporateActionEvents'
      >
    | null
    | undefined,
): HoldingsQtyDriftRow[] {
  if (!data) return [];
  const adjustments = data.reconciliationAdjustments ?? [];
  const deltaIndex = buildQtyReconcileDeltaIndex(adjustments);
  const caEvents = data.corporateActionEvents ?? [];
  const rows: HoldingsQtyDriftRow[] = [];
  for (const portfolio of getPersonalInvestments(data as FinancialData)) {
    for (const h of portfolio.holdings ?? []) {
      const symbol = String(h.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      const ledgerQuantity = integrityLedgerQuantityForSymbol({
        portfolioId: portfolio.id,
        symbol,
        transactions: data.investmentTransactions ?? [],
        adjustments,
        deltaIndex,
        portfolio,
        corporateActionEvents: caEvents,
        mode: 'drift',
      });
      const storedQuantity = Math.max(0, Number(h.quantity) || 0);
      const drift = storedQuantity - ledgerQuantity;
      rows.push({
        portfolioId: portfolio.id,
        portfolioName: portfolio.name ?? portfolio.id,
        symbol,
        storedQuantity,
        ledgerQuantity,
        drift,
        ok: Math.abs(drift) < 0.0001,
      });
    }
  }
  return rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

export function holdingsQtyDriftNeedsAttention(rows: HoldingsQtyDriftRow[]): HoldingsQtyDriftRow[] {
  return rows.filter((r) => !r.ok);
}

/** Raw buy−sell net only (before reconcile adjustments). */
export function ledgerTradeNetAndLastLegForSymbol(args: {
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
  return { net, lastLeg };
}

/**
 * Effective ledger net for Critical missing / last-leg classification.
 * Uses {@link integrityLedgerQuantityForSymbol} in `missing` mode (CA + deltas when needed).
 */
export function ledgerNetAndLastLegForSymbol(args: {
  portfolioId: string;
  symbol: string;
  transactions: InvestmentTransaction[];
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  deltaIndex?: Map<string, number> | null;
  portfolio?: InvestmentPortfolio;
  corporateActionEvents?: CorporateActionEvent[] | null;
}): { net: number; lastLeg: 'buy' | 'sell' | null } {
  const trade = ledgerTradeNetAndLastLegForSymbol(args);
  return {
    net: integrityLedgerQuantityForSymbol({ ...args, mode: 'missing' }),
    lastLeg: trade.lastLeg,
  };
}

/** Symbols on the ledger for a portfolio that are not currently held (possible resurrection candidates if rebuilt). */
export function listLedgerSymbolsMissingFromHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  corporateActionEvents?: CorporateActionEvent[] | null;
}): string[] {
  return classifyMissingLedgerHoldings(args).map((r) => r.symbol);
}

/**
 * Classify missing holdings: likelyOpen (last leg buy + effective net > 0) vs sold/incomplete.
 * Never auto-resurrects — callers use this for UI / opt-in restore only.
 */
export function classifyMissingLedgerHoldings(args: {
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  adjustments?: QtyReconcileAdjustmentLike[] | null;
  corporateActionEvents?: CorporateActionEvent[] | null;
  deltaIndex?: Map<string, number> | null;
}): Omit<MissingLedgerHoldingRow, 'portfolioId' | 'portfolioName'>[] {
  // Only positive qty counts as held — a stale 0-qty row is not an open position and must
  // still surface as critical missing when the *effective* ledger nets shares with last-leg buy.
  const held = new Set(
    (args.portfolio.holdings ?? [])
      .filter((h) => (Number(h.quantity) || 0) > 1e-9)
      .map((h) => String(h.symbol ?? '').trim().toUpperCase())
      .filter(Boolean),
  );
  const deltaIndex = args.deltaIndex ?? buildQtyReconcileDeltaIndex(args.adjustments);
  const scoped = filterTransactionsForPortfolio(args.portfolio.id, args.transactions);
  const symbols = new Set<string>();
  for (const t of scoped) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    const sym = String(t.symbol ?? '').trim().toUpperCase();
    if (sym) symbols.add(sym);
  }
  for (const adj of args.adjustments ?? []) {
    if (String(adj.mechanism ?? '') !== 'reconcile_quantity') continue;
    if (String(adj.portfolioId ?? '') !== args.portfolio.id) continue;
    const sym = String(adj.symbol ?? '').trim().toUpperCase();
    if (sym) symbols.add(sym);
  }
  const out: Omit<MissingLedgerHoldingRow, 'portfolioId' | 'portfolioName'>[] = [];
  for (const sym of [...symbols].sort()) {
    if (held.has(sym)) continue;
    const { net, lastLeg } = ledgerNetAndLastLegForSymbol({
      portfolioId: args.portfolio.id,
      symbol: sym,
      transactions: args.transactions,
      adjustments: args.adjustments,
      deltaIndex,
      portfolio: args.portfolio,
      corporateActionEvents: args.corporateActionEvents,
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
  data:
    | Pick<
        FinancialData,
        'investments' | 'investmentTransactions' | 'reconciliationAdjustments' | 'corporateActionEvents'
      >
    | null
    | undefined,
): MissingLedgerHoldingRow[] {
  if (!data) return [];
  const adjustments = data.reconciliationAdjustments ?? [];
  const deltaIndex = buildQtyReconcileDeltaIndex(adjustments);
  const caEvents = data.corporateActionEvents ?? [];
  const out: MissingLedgerHoldingRow[] = [];
  for (const portfolio of getPersonalInvestments(data as FinancialData)) {
    for (const row of classifyMissingLedgerHoldings({
      portfolio,
      transactions: data.investmentTransactions ?? [],
      adjustments,
      corporateActionEvents: caEvents,
      deltaIndex,
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
