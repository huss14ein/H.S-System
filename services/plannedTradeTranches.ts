import type { PlannedTrade } from '../types';

export function newTrancheGroupId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Split a buy/sell plan into N tranches with shared group id (equal target qty when quantity set). */
export function buildTranchePlansFromParent(
  parent: Omit<PlannedTrade, 'id' | 'user_id'>,
  trancheCount: number,
): Omit<PlannedTrade, 'id' | 'user_id'>[] {
  const n = Math.max(1, Math.min(5, Math.round(trancheCount)));
  if (n <= 1) return [parent];
  const groupId = newTrancheGroupId();
  const totalQty = parent.quantity != null && parent.quantity > 0 ? parent.quantity : undefined;
  const perQty = totalQty != null ? totalQty / n : undefined;
  const perAmount = parent.amount != null && parent.amount > 0 ? Math.round(parent.amount / n) : parent.amount;
  return Array.from({ length: n }, (_, i) => ({
    ...parent,
    trancheGroupId: groupId,
    trancheIndex: i + 1,
    targetQty: perQty,
    filledQty: 0,
    quantity: perQty,
    amount: perAmount,
    notes: [parent.notes, `Tranche ${i + 1}/${n}`].filter(Boolean).join(' · '),
    status: 'Planned' as const,
  }));
}

/** After a tranche fill, recompute remaining qty for the next tranche in the same group. */
export function recomputeTrancheAfterFill(
  trades: PlannedTrade[],
  filledTradeId: string,
  filledQty: number,
): PlannedTrade[] {
  const filled = trades.find((t) => t.id === filledTradeId);
  if (!filled?.trancheGroupId) return trades;
  const groupId = filled.trancheGroupId;
  const idx = filled.trancheIndex ?? 1;
  return trades.map((t) => {
    if (t.trancheGroupId !== groupId) return t;
    if ((t.trancheIndex ?? 1) === idx) {
      return { ...t, filledQty: Math.min(Number(t.targetQty) || filledQty, filledQty), status: 'Executed' as const };
    }
    if ((t.trancheIndex ?? 1) === idx + 1 && t.status === 'Planned') {
      const remaining = Math.max(0, (Number(t.targetQty) || 0) - filledQty);
      return { ...t, targetQty: remaining, notes: [t.notes, `Adjusted after tranche ${idx} fill`].filter(Boolean).join(' · ') };
    }
    return t;
  });
}
