import type { InvestmentTransaction, TradeCurrency } from '../types';
import {
  INVESTMENT_RECONCILIATION_NOTE_PREFIX,
  isInvestmentReconciliationCashAdjustment,
} from './reconciliation/cashDelta';

/**
 * After insert, DB rows may omit `portfolio_id` / `currency` / `note` when those columns are missing.
 * Stamp the intended identity onto the in-memory transaction so holdings replay, cash FX, and
 * capital-KPI exclusion (reconcile deposits/withdrawals) stay correct.
 */
export function stampInvestmentTradeIdentity(
  tx: InvestmentTransaction,
  opts: {
    portfolioId?: string | null;
    currency?: TradeCurrency | string | null;
    note?: string | null;
  },
): InvestmentTransaction {
  const portfolioId =
    tx.portfolioId ||
    (opts.portfolioId != null && String(opts.portfolioId).trim() !== '' ? String(opts.portfolioId) : undefined);
  const raw = opts.currency ?? tx.currency;
  const currency: TradeCurrency | undefined = raw === 'SAR' || raw === 'USD' ? raw : tx.currency;
  const noteFromOpts =
    opts.note != null && String(opts.note).trim() !== '' ? String(opts.note).trim().slice(0, 200) : undefined;
  const note = tx.note || noteFromOpts;
  if (portfolioId === tx.portfolioId && currency === tx.currency && note === tx.note) return tx;
  return {
    ...tx,
    ...(portfolioId ? { portfolioId } : {}),
    ...(currency ? { currency } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Keep in-memory reconcile stamps when a hydrate fetch returns rows without `note`
 * (missing column / race before secondary stamp).
 */
export function mergePreserveInvestmentReconcileNotes(
  incoming: InvestmentTransaction[],
  prior: InvestmentTransaction[] | null | undefined,
): InvestmentTransaction[] {
  if (!prior?.length) return incoming;
  const noteById = new Map<string, string>();
  for (const t of prior) {
    const n = String(t.note ?? '').trim();
    if (n) noteById.set(String(t.id), n);
  }
  if (noteById.size === 0) return incoming;
  let changed = false;
  const next = incoming.map((t) => {
    if (String(t.note ?? '').trim()) return t;
    const n = noteById.get(String(t.id));
    if (!n) return t;
    changed = true;
    return { ...t, note: n };
  });
  return changed ? next : incoming;
}

function reconcileNoteFromReason(reason?: string | null): string {
  const r = String(reason ?? '').trim() || 'Broker cash reconcile';
  return `${INVESTMENT_RECONCILIATION_NOTE_PREFIX} ${r}`.slice(0, 200);
}

type HeuristicAdj = {
  accountId: string;
  date: string;
  type: 'deposit' | 'withdrawal';
  total: number;
  note: string;
};

/**
 * Re-attach reconcile stamps to investment deposit/withdrawal rows so capital KPIs / History
 * never treat them as economic WITHDRAWAL/DEPOSIT.
 *
 * 1) Linked: `reconciliation_adjustments.generated_investment_transaction_id` (authoritative)
 * 2) Heuristic: only when **unambiguous** — exactly one unlinked adj and exactly one CASH
 *    deposit/withdrawal for the same account+date+type+amount (±0.02). Never stamp when
 *    multiple capital rows share that fingerprint (would mis-tag real Invested/Withdrawn).
 */
export function stampReconciliationNotesOntoInvestmentTransactions(
  txs: InvestmentTransaction[],
  adjustments: Array<{
    generatedInvestmentTransactionId?: string | null;
    reason?: string | null;
    mechanism?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    accountId?: string | null;
    effectiveDate?: string | null;
    delta?: number | null;
    status?: string | null;
    reversedByAdjustmentId?: string | null;
  }>,
): InvestmentTransaction[] {
  const byId = new Map<string, string>();
  const heuristics: HeuristicAdj[] = [];

  for (const adj of adjustments) {
    const entity = String(adj.entityType ?? '').toLowerCase();
    if (entity && entity !== 'account') continue;
    const mechanism = String(adj.mechanism ?? '').toLowerCase();
    if (
      mechanism &&
      mechanism !== 'reconcile_balance' &&
      mechanism !== 'opening_balance' &&
      mechanism !== 'reverse_adjustment'
    ) {
      continue;
    }
    if (String(adj.status ?? '').toLowerCase() === 'noop') continue;
    if (String(adj.status ?? '').toLowerCase() === 'reversed') continue;
    if (adj.reversedByAdjustmentId) continue;

    const note = reconcileNoteFromReason(adj.reason);
    const linkedId = String(adj.generatedInvestmentTransactionId ?? '').trim();
    if (linkedId) {
      byId.set(linkedId, note);
      continue;
    }

    const accountId = String(adj.accountId ?? adj.entityId ?? '').trim();
    const date = String(adj.effectiveDate ?? '').slice(0, 10);
    const delta = Number(adj.delta);
    if (!accountId || !date || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) continue;
    heuristics.push({
      accountId,
      date,
      type: delta < 0 ? 'withdrawal' : 'deposit',
      total: Math.abs(delta),
      note,
    });
  }

  if (byId.size === 0 && heuristics.length === 0) return txs;

  /** amountCents key → adj notes (only unambiguous 1:1 keys survive). */
  const adjByFingerprint = new Map<string, HeuristicAdj[]>();
  for (const h of heuristics) {
    const key = `${h.accountId}|${h.date}|${h.type}|${Math.round(h.total * 100)}`;
    const list = adjByFingerprint.get(key) ?? [];
    list.push(h);
    adjByFingerprint.set(key, list);
  }

  const txCandidatesByFingerprint = new Map<string, string[]>();
  for (const t of txs) {
    const typ = String(t.type ?? '').toLowerCase();
    if (typ !== 'deposit' && typ !== 'withdrawal') continue;
    if (isInvestmentReconciliationCashAdjustment(t)) continue;
    if (byId.has(String(t.id))) continue;
    const symbol = String(t.symbol ?? '').trim().toUpperCase();
    if (symbol && symbol !== 'CASH') continue;
    const accountId = String(t.accountId ?? (t as { account_id?: string }).account_id ?? '').trim();
    const date = String(t.date ?? '').slice(0, 10);
    const totalCents = Math.round(Math.abs(Number(t.total) || 0) * 100);
    const key = `${accountId}|${date}|${typ}|${totalCents}`;
    const list = txCandidatesByFingerprint.get(key) ?? [];
    list.push(String(t.id));
    txCandidatesByFingerprint.set(key, list);
  }

  const unambiguousNoteByTxId = new Map<string, string>();
  for (const [key, adjs] of adjByFingerprint) {
    if (adjs.length !== 1) continue;
    const txIds = txCandidatesByFingerprint.get(key) ?? [];
    if (txIds.length !== 1) continue;
    unambiguousNoteByTxId.set(txIds[0]!, adjs[0]!.note);
  }

  let changed = false;
  const next = txs.map((t) => {
    const typ = String(t.type ?? '').toLowerCase();
    if (typ !== 'deposit' && typ !== 'withdrawal') return t;
    if (isInvestmentReconciliationCashAdjustment(t)) return t;

    const linked = byId.get(String(t.id));
    if (linked) {
      changed = true;
      return { ...t, note: linked };
    }

    const heuristicNote = unambiguousNoteByTxId.get(String(t.id));
    if (!heuristicNote) return t;
    changed = true;
    return { ...t, note: heuristicNote };
  });
  return changed ? next : txs;
}
