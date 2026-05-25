/**
 * Tranche execution tracking for Recovery Plan: reconcile PlannedTrade fills
 * and recompute remaining recycling / buy-ladder steps.
 */

import type { Holding, PlannedTrade, RecoveryOrderDraft } from '../types';
import { reconcileAfterFill } from './recoveryPlan';

export type RecoveryTrancheKind = 'recycle_sell' | 'recycle_rebuy' | 'ladder_buy';

export type RecoveryTrancheIndex = 1 | 2 | 3;

export interface RecoveryTrancheKey {
  kind: RecoveryTrancheKind;
  index: RecoveryTrancheIndex;
}

export type RecoveryTrancheFillStatus = 'pending' | 'filled' | 'skipped';

export interface RecoveryTrancheExecutionState {
  key: RecoveryTrancheKey;
  label: string;
  side: 'BUY' | 'SELL';
  qty: number;
  limitPrice: number;
  status: RecoveryTrancheFillStatus;
  plannedTradeId?: string;
  filledQty?: number;
  filledPrice?: number;
}

const TRANCHE_RE =
  /(?:recycle\s+(?:sell|rebuy)|recovery)\s+(?:t|l)\s*([123])|(?:sell|rebuy)\s+t\s*([123])|ladder\s*l?\s*([123])/i;

export function parseTrancheFromLabel(label?: string): RecoveryTrancheKey | null {
  const text = String(label ?? '').trim();
  if (!text) return null;
  const m = text.match(TRANCHE_RE);
  const idx = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
  if (!(idx >= 1 && idx <= 3)) return null;
  const index = idx as RecoveryTrancheIndex;
  const lower = text.toLowerCase();
  if (lower.includes('recycle') && lower.includes('rebuy')) {
    return { kind: 'recycle_rebuy', index };
  }
  if (lower.includes('recycle') && lower.includes('sell')) {
    return { kind: 'recycle_sell', index };
  }
  if (lower.includes('recovery l') || lower.includes('ladder')) {
    return { kind: 'ladder_buy', index };
  }
  if (lower.includes('rebuy')) return { kind: 'recycle_rebuy', index };
  if (lower.includes('sell')) return { kind: 'recycle_sell', index };
  return { kind: 'ladder_buy', index };
}

export function parseTrancheFromPlannedTrade(trade: PlannedTrade): RecoveryTrancheKey | null {
  return parseTrancheFromLabel(trade.notes ?? trade.name);
}

export function trancheKeyToString(key: RecoveryTrancheKey): string {
  return `${key.kind}:${key.index}`;
}

export function matchTrancheKeys(a: RecoveryTrancheKey, b: RecoveryTrancheKey): boolean {
  return a.kind === b.kind && a.index === b.index;
}

/** Map recovery drafts to execution rows and overlay PlannedTrade status. */
export function buildTrancheExecutionStates(
  symbol: string,
  drafts: RecoveryOrderDraft[],
  plannedTrades: PlannedTrade[],
): RecoveryTrancheExecutionState[] {
  const sym = symbol.toUpperCase();
  const related = (plannedTrades ?? []).filter((t) => (t.symbol ?? '').toUpperCase() === sym);

  return drafts.map((d) => {
    const key =
      d.trancheKind && d.trancheIndex
        ? { kind: d.trancheKind, index: d.trancheIndex as RecoveryTrancheIndex }
        : parseTrancheFromLabel(d.label) ?? {
            kind: (d.type === 'SELL' ? 'recycle_sell' : 'ladder_buy') as RecoveryTrancheKind,
            index: 1 as RecoveryTrancheIndex,
          };
    const label = d.label ?? `${d.type} T${key.index}`;
    const match = related.find((t) => {
      const tk = parseTrancheFromPlannedTrade(t);
      return tk && matchTrancheKeys(tk, key);
    });
    const executed = match?.status === 'Executed';
    return {
      key,
      label,
      side: d.type,
      qty: d.qty,
      limitPrice: d.limitPrice,
      status: executed ? 'filled' : 'pending',
      plannedTradeId: match?.id,
      filledQty: executed ? (match?.quantity ?? d.qty) : undefined,
      filledPrice: executed ? (match?.targetValue ?? d.limitPrice) : undefined,
    };
  });
}

export function getFilledTrancheIndexes(
  states: RecoveryTrancheExecutionState[],
  kind: RecoveryTrancheKind,
): Set<RecoveryTrancheIndex> {
  const out = new Set<RecoveryTrancheIndex>();
  for (const s of states) {
    if (s.key.kind === kind && s.status === 'filled') {
      out.add(s.key.index);
    }
  }
  return out;
}

/** Apply executed recovery/recycling trades to holding for replanning (preview). */
export function inferHoldingAfterTrancheFills(
  holding: Holding,
  states: RecoveryTrancheExecutionState[],
): Holding {
  let shares = Math.max(0, Number(holding.quantity) || 0);
  let avg = Math.max(0, Number(holding.avgCost) || 0);
  const ordered = [...states]
    .filter((s) => s.status === 'filled')
    .sort((a, b) => a.key.index - b.key.index);

  for (const s of ordered) {
    const qty = Math.max(0, Number(s.filledQty ?? s.qty) || 0);
    const px = Math.max(0, Number(s.filledPrice ?? s.limitPrice) || 0);
    if (!(qty > 0) || !(px > 0)) continue;
    if (s.side === 'BUY') {
      const next = reconcileAfterFill(shares, avg, qty, px);
      shares = next.newShares;
      avg = next.newAvgCost;
    } else {
      shares = Math.max(0, shares - qty);
    }
  }

  return { ...holding, quantity: shares, avgCost: avg };
}

export function pendingDraftsOnly(
  drafts: RecoveryOrderDraft[],
  states: RecoveryTrancheExecutionState[],
): RecoveryOrderDraft[] {
  return drafts.filter((d) => {
    const key =
      d.trancheKind && d.trancheIndex
        ? { kind: d.trancheKind, index: d.trancheIndex as RecoveryTrancheIndex }
        : parseTrancheFromLabel(d.label);
    if (!key) return true;
    const st = states.find((s) => matchTrancheKeys(s.key, key));
    return !st || st.status !== 'filled';
  });
}

export function executionProgressLabel(states: RecoveryTrancheExecutionState[]): string {
  const filled = states.filter((s) => s.status === 'filled').length;
  if (states.length === 0) return 'No tranches';
  if (filled === 0) return `${states.length} tranche(s) pending`;
  if (filled >= states.length) return 'All tranches filled';
  const next = states.find((s) => s.status === 'pending');
  const nextLabel = next ? next.label : 'next tranche';
  return `${filled}/${states.length} filled — recompute ${nextLabel}`;
}
