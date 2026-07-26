/**
 * Transfer-safe corrections.
 *
 * A transfer is two (or three, with a fee) ledger rows sharing `transferGroupId`. Editing or deleting
 * one row on its own leaves the other side dangling: money appears created or destroyed. Corrections
 * must therefore either keep the money-moving fields untouched or act on the whole group.
 */
import type { Transaction } from '../../types';

export function transferGroupIdOf(tx: Partial<Transaction> | null | undefined): string | null {
  if (!tx) return null;
  const raw = tx.transferGroupId ?? (tx as { transfer_group_id?: string }).transfer_group_id;
  const id = String(raw ?? '').trim();
  return id.length ? id : null;
}

export function isTransferLeg(tx: Partial<Transaction> | null | undefined): boolean {
  return transferGroupIdOf(tx) != null;
}

/** All rows of the group (principal out/in plus any fee leg), ordered as stored. */
export function transferLegsForGroup(
  transactions: Transaction[] | undefined,
  groupId: string | null | undefined,
): Transaction[] {
  const id = String(groupId ?? '').trim();
  if (!id) return [];
  return (transactions ?? []).filter((t) => transferGroupIdOf(t) === id);
}

const MONEY_FIELDS = ['amount', 'accountId', 'date', 'type'] as const;

/**
 * Returns a blocking message when a single-leg edit would break the pair, or `null` when the edit is
 * safe (description/memo/category-only changes).
 */
export function assertTransferEditAllowed(
  prev: Transaction | null | undefined,
  next: Transaction | null | undefined,
): string | null {
  const groupId = transferGroupIdOf(prev) ?? transferGroupIdOf(next);
  if (!groupId || !prev || !next) return null;
  const changed = MONEY_FIELDS.filter((field) => {
    if (field === 'amount') {
      return Math.abs((Number(next.amount) || 0) - (Number(prev.amount) || 0)) > 0.00005;
    }
    return String(next[field] ?? '') !== String(prev[field] ?? '');
  });
  if (!changed.length) return null;
  return (
    'This row is one leg of a transfer. Changing its amount, account, date, or direction would leave the ' +
    'other leg unbalanced. Delete the transfer (all legs are removed together) and re-enter it, or use ' +
    'Reconcile Balance on the affected account.'
  );
}

/** Ids to delete for a correct transfer removal: the whole group, or just the row when not a transfer. */
export function transferDeleteCascadeIds(
  transactions: Transaction[] | undefined,
  transactionId: string,
): string[] {
  const tx = (transactions ?? []).find((t) => String(t.id) === String(transactionId));
  const groupId = transferGroupIdOf(tx);
  if (!groupId) return [String(transactionId)];
  const legs = transferLegsForGroup(transactions, groupId).map((t) => String(t.id));
  return legs.length ? legs : [String(transactionId)];
}

export function describeTransferDeleteCascade(count: number): string | null {
  if (count <= 1) return null;
  return `Both sides of this transfer were removed (${count} ledger rows) so no leg is left orphaned.`;
}
